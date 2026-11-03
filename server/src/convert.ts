import './polyfills.js'

import {
  AcDbDatabase,
  AcDbDatabaseConverterManager,
  AcDbFileType,
  acdbHostApplicationServices
} from '@mlightcad/data-model'
import { AcDbLibreDwgMainThreadConverter } from '@mlightcad/libredwg-converter/node'
import {
  exportDatabaseToPdf,
  type AcPdfExportOptions
} from '@mlightcad/pdf-renderer'
import path from 'node:path'

import {
  buildFontMapping,
  createTextFontResolver,
  ensureFontsLoaded
} from './fonts.js'
import { createNodePdfGlyphProvider } from './glyphProvider.js'

export type ConvertPdfOptions = {
  /** Fit model space to drawing extents (default) or keep as-is */
  fit?: 'extents' | 'current'
  /** Export all paper-space layouts as extra PDF pages */
  exportLayouts?: boolean
  /** PDF document title */
  title?: string
}

/**
 * Options for {@link convertCadToDxf}, mirroring
 * `AcDbDatabase.dxfOut` / Script API `cad.file.saveDxf` behaviour.
 * @see https://mlightcad.com/cad-viewer/docs/guide/script/api.html
 */
export type ConvertDxfOptions = {
  /** Numeric precision for DXF reals. Defaults to 6 (same as AcApDxfConvertor). */
  precision?: number
  /** Target DXF version name/value (e.g. 'AC1032'). Uses drawing default when omitted. */
  version?: string | number
  /** Output encoding. Defaults to ascii. */
  format?: 'ascii' | 'binary'
  /** Include thumbnail image section when available. */
  saveThumbnailImage?: boolean
}

let dwgRegistered = false
let glyphProvider: ReturnType<typeof createNodePdfGlyphProvider> | null = null

function ensureDwgConverter() {
  if (dwgRegistered) return

  const converter = new AcDbLibreDwgMainThreadConverter({
    convertByEntityType: false,
    useWorker: false
  })
  AcDbDatabaseConverterManager.instance.register(AcDbFileType.DWG, converter)
  dwgRegistered = true
}

function detectFileType(fileName: string): AcDbFileType {
  const ext = path.extname(fileName).toLowerCase()
  if (ext === '.dwg') return AcDbFileType.DWG
  if (ext === '.dxf') return AcDbFileType.DXF
  throw new Error(`Unsupported file type "${ext}". Only .dwg and .dxf are accepted.`)
}

async function loadDatabase(
  buffer: ArrayBuffer,
  fileName: string
): Promise<AcDbDatabase> {
  const fileType = detectFileType(fileName)
  if (fileType === AcDbFileType.DWG) {
    ensureDwgConverter()
  }

  const database = new AcDbDatabase()
  acdbHostApplicationServices().workingDatabase = database

  await database.read(
    buffer,
    {
      minimumChunkSize: 1000,
      readOnly: true
    },
    fileType
  )

  return database
}

/**
 * Load a DWG/DXF buffer into AcDbDatabase, then export a vector PDF
 * via @mlightcad/pdf-renderer (same backend as cad-pdf-plugin).
 *
 * Text requires either:
 * - textMode:'text' + textFontResolver (embed TTF), or
 * - glyphProvider (tessellate via mtext-renderer)
 * Without both, TEXT/MTEXT produce no visible geometry.
 */
export async function convertCadToPdf(
  buffer: ArrayBuffer,
  fileName: string,
  options: ConvertPdfOptions = {}
): Promise<Uint8Array> {
  const fontEntries = await ensureFontsLoaded()
  if (!glyphProvider) {
    glyphProvider = createNodePdfGlyphProvider()
  }

  const database = await loadDatabase(buffer, fileName)

  const pdfOptions: AcPdfExportOptions = {
    title: options.title ?? fileName.replace(/\.(dwg|dxf)$/i, ''),
    background: 'none',
    showLineWeight: !!database.lwdisplay,
    ltscale: database.ltscale,
    celtscale: database.celtscale,
    fit: options.fit === 'current' ? 'current' : 'extents',
    layouts: options.exportLayouts ? 'all' : 'current',
    // Prefer searchable embedded text; SHX / uncovered runs fall back to glyphs.
    textMode: 'text',
    textFontResolver: createTextFontResolver(fontEntries),
    glyphProvider,
    fontMapping: buildFontMapping(fontEntries)
  }

  const bytes = await exportDatabaseToPdf(database, pdfOptions)
  return bytes
}

/**
 * Load a DWG/DXF buffer into AcDbDatabase, then export DXF via
 * `AcDbDatabase.dxfOut` — same path as cad-simple-viewer `AcApDxfConvertor`
 * and Script API `cad.file.saveDxf`.
 */
export async function convertCadToDxf(
  buffer: ArrayBuffer,
  fileName: string,
  options: ConvertDxfOptions = {}
): Promise<{ bytes: Uint8Array; contentType: string; format: 'ascii' | 'binary' }> {
  const database = await loadDatabase(buffer, fileName)

  const precision =
    typeof options.precision === 'number' && Number.isFinite(options.precision)
      ? Math.max(0, Math.min(16, Math.floor(options.precision)))
      : 6
  const format = options.format === 'binary' ? 'binary' : 'ascii'

  const dxfContent = database.dxfOut(undefined, precision, options.version, {
    saveThumbnailImage: options.saveThumbnailImage === true,
    format
  })

  if (typeof dxfContent === 'string') {
    return {
      bytes: new TextEncoder().encode(dxfContent),
      contentType: 'application/dxf; charset=utf-8',
      format: 'ascii'
    }
  }

  return {
    bytes: dxfContent,
    contentType: 'application/dxf',
    format: 'binary'
  }
}

/** @deprecated Use ConvertPdfOptions */
export type ConvertOptions = ConvertPdfOptions
