import './polyfills.js'

import cors from 'cors'
import express from 'express'
import multer from 'multer'
import os from 'node:os'
import path from 'node:path'

import { convertCadToDxf, convertCadToPdf } from './convert.js'

const PORT = Number(process.env.PORT ?? 3100)
const HOST = process.env.HOST ?? '0.0.0.0'
const MAX_FILE_SIZE = 80 * 1024 * 1024 // 80 MB

function getLanIPv4(): string[] {
  const nets = os.networkInterfaces()
  const result: string[] = []
  for (const entries of Object.values(nets)) {
    for (const net of entries ?? []) {
      if (net.family === 'IPv4' && !net.internal) {
        result.push(net.address)
      }
    }
  }
  return result
}

function toArrayBuffer(file: Express.Multer.File): ArrayBuffer {
  return file.buffer.buffer.slice(
    file.buffer.byteOffset,
    file.buffer.byteOffset + file.buffer.byteLength
  ) as ArrayBuffer
}

function downloadBaseName(originalName: string): string {
  return path.basename(originalName, path.extname(originalName)) || 'drawing'
}

const app = express()
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
  fileFilter(_req, file, cb) {
    const ext = path.extname(file.originalname).toLowerCase()
    if (ext === '.dwg' || ext === '.dxf') {
      cb(null, true)
      return
    }
    cb(new Error('Only .dwg / .dxf files are allowed'))
  }
})

app.use(cors())
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'cad-convert',
    version: '1.1.0',
    endpoints: ['/api/convert', '/api/convert-dxf']
  })
})

/**
 * POST /api/convert
 * multipart form-data:
 *   - file: DWG or DXF
 *   - fit: extents | current (optional)
 *   - exportLayouts: true | false (optional)
 */
app.post('/api/convert', upload.single('file'), async (req, res) => {
  const started = Date.now()
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Missing file field "file"' })
      return
    }

    const fit = (req.body?.fit as string | undefined) === 'current' ? 'current' : 'extents'
    const exportLayouts =
      String(req.body?.exportLayouts ?? 'false').toLowerCase() === 'true'

    const pdfBytes = await convertCadToPdf(toArrayBuffer(req.file), req.file.originalname, {
      fit,
      exportLayouts,
      title: req.file.originalname
    })

    const downloadName = `${downloadBaseName(req.file.originalname)}.pdf`

    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`)
    res.setHeader('X-Convert-Ms', String(Date.now() - started))
    res.send(Buffer.from(pdfBytes))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[convert-pdf]', message)
    res.status(500).json({
      error: 'Conversion failed',
      message,
      elapsedMs: Date.now() - started
    })
  }
})

/**
 * POST /api/convert-dxf
 * multipart form-data:
 *   - file: DWG or DXF
 *   - precision: number (optional, default 6)
 *   - format: ascii | binary (optional, default ascii)
 *   - version: DXF version string/number (optional)
 *   - saveThumbnailImage: true | false (optional)
 *
 * Same backend as Script API cad.file.saveDxf / AcApDxfConvertor:
 * https://mlightcad.com/cad-viewer/docs/guide/script/api.html
 */
app.post('/api/convert-dxf', upload.single('file'), async (req, res) => {
  const started = Date.now()
  try {
    if (!req.file) {
      res.status(400).json({ error: 'Missing file field "file"' })
      return
    }

    const precisionRaw = req.body?.precision
    const precision =
      precisionRaw === undefined || precisionRaw === ''
        ? undefined
        : Number(precisionRaw)

    const format =
      String(req.body?.format ?? 'ascii').toLowerCase() === 'binary'
        ? 'binary'
        : 'ascii'

    const versionRaw = req.body?.version
    const version =
      versionRaw === undefined || String(versionRaw).trim() === ''
        ? undefined
        : String(versionRaw)

    const saveThumbnailImage =
      String(req.body?.saveThumbnailImage ?? 'false').toLowerCase() === 'true'

    const result = await convertCadToDxf(toArrayBuffer(req.file), req.file.originalname, {
      precision: Number.isFinite(precision) ? precision : undefined,
      format,
      version,
      saveThumbnailImage
    })

    const downloadName = `${downloadBaseName(req.file.originalname)}.dxf`

    res.setHeader('Content-Type', result.contentType)
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(downloadName)}"`)
    res.setHeader('X-Convert-Ms', String(Date.now() - started))
    res.setHeader('X-Dxf-Format', result.format)
    res.send(Buffer.from(result.bytes))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[convert-dxf]', message)
    res.status(500).json({
      error: 'Conversion failed',
      message,
      elapsedMs: Date.now() - started
    })
  }
})

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction
  ) => {
    res.status(400).json({ error: err.message || 'Bad request' })
  }
)

app.listen(PORT, HOST, () => {
  console.log(`[cad-convert] Local:   http://localhost:${PORT}`)
  for (const ip of getLanIPv4()) {
    console.log(`[cad-convert] Network: http://${ip}:${PORT}`)
  }
  console.log(`[cad-convert] POST /api/convert      → PDF`)
  console.log(`[cad-convert] POST /api/convert-dxf  → DXF`)
})
