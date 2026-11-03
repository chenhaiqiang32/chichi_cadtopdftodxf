import { FontManager, type FontInfo, type FontLoader, type FontLoadStatus } from '@mlightcad/mtext-renderer'
import type { AcPdfTextFontResolver } from '@mlightcad/pdf-renderer'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** Only source of fonts — never fall back to Windows/system Fonts. */
export function getFontsDir(): string {
  return path.resolve(__dirname, '../fonts')
}

type CatalogRaw = {
  file: string
  name: string[]
  type: 'mesh' | 'shx'
  encoding?: string
}

type FontEntry = {
  /** Primary logical name used by FontManager / fontMapping */
  primary: string
  fileName: string
  aliases: string[]
  type: 'mesh' | 'shx'
  /** Embeddable program bytes (mesh only); SHX stays undefined */
  bytes?: Uint8Array
}

let fontsReady: Promise<FontEntry[]> | null = null

function normalizeFontKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\.(ttf|otf|woff|shx|ttc)$/i, '')
}

/**
 * Prefer TTF/OTF over WOFF for pdf-lib embedding when both exist
 * (e.g. catalog lists simsun.woff but simsun.ttf is also present).
 */
function resolveEmbedFile(fontsDir: string, catalogFile: string): string | undefined {
  const base = path.parse(catalogFile).name
  for (const ext of ['.ttf', '.otf', '.woff'] as const) {
    const candidate = path.join(fontsDir, `${base}${ext}`)
    if (fs.existsSync(candidate)) return candidate
  }
  const exact = path.join(fontsDir, catalogFile)
  return fs.existsSync(exact) ? exact : undefined
}

/**
 * Disk-backed FontLoader: serves `server/fonts/fonts.json` and font files
 * without hitting CDN / system Fonts.
 */
class LocalFontsLoader implements FontLoader {
  private readonly fontsDir: string
  private _baseUrl: string
  private catalog: FontInfo[] = []
  private byName = new Map<string, FontInfo>()
  private loadedPromise: Promise<void> | null = null

  constructor(fontsDir: string) {
    this.fontsDir = fontsDir
    this._baseUrl = pathToFileURL(fontsDir.endsWith(path.sep) ? fontsDir : fontsDir + path.sep).href
  }

  get baseUrl(): string {
    return this._baseUrl
  }

  set baseUrl(value: string) {
    this._baseUrl = value
  }

  private ensureCatalog(): void {
    if (this.catalog.length > 0) return
    const catalogPath = path.join(this.fontsDir, 'fonts.json')
    if (!fs.existsSync(catalogPath)) {
      throw new Error(`[fonts] missing catalog: ${catalogPath}`)
    }
    const raw = JSON.parse(fs.readFileSync(catalogPath, 'utf8')) as CatalogRaw[]
    this.catalog = []
    this.byName.clear()
    for (const entry of raw) {
      const filePath = path.join(this.fontsDir, entry.file)
      if (!fs.existsSync(filePath)) {
        console.warn(`[fonts] catalog file missing, skip: ${entry.file}`)
        continue
      }
      const info: FontInfo = {
        file: entry.file,
        name: entry.name,
        type: entry.type,
        encoding: entry.encoding,
        url: pathToFileURL(filePath).href,
        source: 'cache'
      }
      this.catalog.push(info)
      for (const n of entry.name) {
        this.byName.set(normalizeFontKey(n), info)
      }
      this.byName.set(normalizeFontKey(entry.file), info)
    }
  }

  async getAvailableFonts(): Promise<FontInfo[]> {
    this.ensureCatalog()
    return this.catalog
  }

  /**
   * FontManager calls this for on-demand faces. We register via cacheFont
   * from local files (no network).
   */
  async load(fontNames: readonly string[]): Promise<FontLoadStatus[]> {
    this.ensureCatalog()
    const manager = FontManager.instance
    const results: FontLoadStatus[] = []

    for (const rawName of fontNames) {
      const key = normalizeFontKey(rawName)
      const info = this.byName.get(key)
      if (!info) {
        results.push({ fontName: rawName, url: '', status: 'NotFound' })
        continue
      }
      if (manager.isFontLoaded(info.name[0] ?? key)) {
        results.push({ fontName: rawName, url: info.url, status: 'Success' })
        continue
      }
      try {
        const filePath = path.join(this.fontsDir, info.file)
        const bytes = fs.readFileSync(filePath)
        const status = await manager.cacheFont(
          bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
          info.file,
          info.name,
          info.encoding
        )
        results.push({
          fontName: rawName,
          url: info.url,
          status: status.status === 'Success' ? 'Success' : 'FailedToLoad'
        })
      } catch (err) {
        console.warn(
          `[fonts] failed to load ${info.file}:`,
          err instanceof Error ? err.message : err
        )
        results.push({ fontName: rawName, url: info.url, status: 'FailedToLoad' })
      }
    }
    return results
  }

  /** Eagerly register every catalog font into FontManager (once). */
  async preloadAll(): Promise<FontEntry[]> {
    if (this.loadedPromise) {
      await this.loadedPromise
    } else {
      this.loadedPromise = (async () => {
        this.ensureCatalog()
        const names = this.catalog.flatMap((f) => f.name)
        // Deduplicate by file via load() of unique primaries
        const unique = [...new Set(this.catalog.map((f) => f.name[0] ?? normalizeFontKey(f.file)))]
        console.log(`[fonts] loading ${unique.length} faces from ${this.fontsDir}`)
        await this.load(unique)
        // Also accept any alias request path for names not covered as primary
        void names
      })()
      await this.loadedPromise
    }

    this.ensureCatalog()
    const entries: FontEntry[] = []
    for (const info of this.catalog) {
      const primary = info.name[0] ?? normalizeFontKey(info.file)
      let bytes: Uint8Array | undefined
      if (info.type === 'mesh') {
        const embedPath = resolveEmbedFile(this.fontsDir, info.file)
        if (embedPath) {
          bytes = new Uint8Array(fs.readFileSync(embedPath))
        }
      }
      entries.push({
        primary: normalizeFontKey(primary),
        fileName: info.file,
        aliases: info.name,
        type: info.type,
        bytes
      })
    }
    return entries
  }
}

/**
 * Load all fonts exclusively from `server/fonts` (fonts.json + files).
 */
export async function ensureFontsLoaded(): Promise<FontEntry[]> {
  if (fontsReady) return fontsReady

  fontsReady = (async () => {
    const fontsDir = getFontsDir()
    if (!fs.existsSync(fontsDir)) {
      throw new Error(`[fonts] directory not found: ${fontsDir}`)
    }

    const manager = FontManager.instance
    manager.enableFontCache = false
    manager.lazyFontLoading = true
    manager.awaitFontsBeforeDraw = true

    const loader = new LocalFontsLoader(fontsDir)
    manager.setFontLoader(loader)
    manager.baseUrl = loader.baseUrl

    const entries = await loader.preloadAll()

    const defaults = ['simsun', 'arial', 'simhei', 'txt', 'hztxt', 'simplex']
      .map((n) => normalizeFontKey(n))
      .filter((n) => entries.some((e) => e.primary === n || e.aliases.some((a) => normalizeFontKey(a) === n)))

    if (defaults.length > 0) {
      manager.setDefaultFonts(defaults)
    }

    const meshCount = entries.filter((e) => e.type === 'mesh').length
    const shxCount = entries.filter((e) => e.type === 'shx').length
    console.log(
      `[fonts] ready from server/fonts — mesh=${meshCount} shx=${shxCount} default=[${defaults.join(', ')}]`
    )

    return entries
  })()

  return fontsReady
}

function resolveEntry(
  entries: FontEntry[],
  fontName: string
): FontEntry | undefined {
  const key = normalizeFontKey(fontName)
  for (const entry of entries) {
    if (entry.primary === key) return entry
    if (entry.aliases.some((a) => normalizeFontKey(a) === key)) return entry
  }
  return undefined
}

/**
 * Resolver for pdf-renderer textMode:'text'.
 * Only returns bytes for mesh fonts present under server/fonts.
 * SHX / unknown names → undefined (glyphProvider + local SHX handles them).
 */
export function createTextFontResolver(
  entries: FontEntry[]
): AcPdfTextFontResolver {
  return async (fontName: string) => {
    const entry = resolveEntry(entries, fontName)
    if (!entry || entry.type !== 'mesh' || !entry.bytes || entry.bytes.byteLength === 0) {
      return undefined
    }
    return entry.bytes
  }
}

/** Map CAD style font names → loaded primary names (from fonts.json aliases). */
export function buildFontMapping(entries: FontEntry[]): Record<string, string> {
  const mapping: Record<string, string> = {}
  for (const entry of entries) {
    for (const alias of entry.aliases) {
      mapping[alias] = entry.primary
      mapping[alias.toUpperCase()] = entry.primary
      mapping[normalizeFontKey(alias)] = entry.primary
    }
  }
  return mapping
}
