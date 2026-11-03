import '../src/polyfills.js'
import fs from 'node:fs'
import path from 'node:path'
import {
  AcDbDatabase,
  AcDbDatabaseConverterManager,
  AcDbFileType,
  acdbHostApplicationServices,
  AcDbOle2Frame,
  acdbRasterizeOleMetafile
} from '@mlightcad/data-model'
import { AcDbLibreDwgMainThreadConverter } from '@mlightcad/libredwg-converter/node'
import { convertCadToPdf } from '../src/convert.ts'

const dwgPath =
  process.argv[2] ||
  'd:\\work\\炽橙科技\\图纸精灵\\modelcollab\\example\\上高县东方星城小区地下车库地形图.dwg'
const outDir = path.resolve('server/tmp')
fs.mkdirSync(outDir, { recursive: true })

console.log('OffscreenCanvas:', typeof OffscreenCanvas)
console.log('createImageBitmap:', typeof createImageBitmap)

const converter = new AcDbLibreDwgMainThreadConverter({
  convertByEntityType: false,
  useWorker: false
})
AcDbDatabaseConverterManager.instance.register(AcDbFileType.DWG, converter)

const buffer = fs.readFileSync(dwgPath).buffer
const database = new AcDbDatabase()
acdbHostApplicationServices().workingDatabase = database
await database.read(buffer, { minimumChunkSize: 1000, readOnly: true }, AcDbFileType.DWG)

let ole = null
for (const entity of database.tables.blockTable.modelSpace.newIterator()) {
  if (entity instanceof AcDbOle2Frame) {
    ole = entity
    break
  }
}
if (!ole) {
  console.error('FAIL: no OLE2FRAME in DWG')
  process.exit(1)
}

const emf = ole.image
console.log('OLE EMF:', emf && { size: emf.size, type: emf.type })
const png = await acdbRasterizeOleMetafile(emf)
if (!png) {
  console.error('FAIL: EMF rasterization returned null')
  process.exit(1)
}
console.log('OLE PNG:', { size: png.size, type: png.type })
const pngPath = path.join(outDir, 'ole-table.png')
fs.writeFileSync(pngPath, Buffer.from(await png.arrayBuffer()))
console.log('Wrote', pngPath)

console.log('Converting DWG → PDF…')
const t0 = Date.now()
const pdfBytes = await convertCadToPdf(buffer, path.basename(dwgPath), {
  fit: 'extents',
  title: path.basename(dwgPath)
})
const elapsed = Date.now() - t0
const pdfPath = path.join(outDir, 'verify-ole.pdf')
fs.writeFileSync(pdfPath, pdfBytes)
console.log(`PDF written: ${pdfPath} (${pdfBytes.byteLength} bytes, ${elapsed} ms)`)

// Count embedded images via raw PDF markers
const text = Buffer.from(pdfBytes).toString('latin1')
const imageXObjects = (text.match(/\/Subtype\s*\/Image\b/g) || []).length
const xobjects = (text.match(/\/XObject\b/g) || []).length
console.log('PDF /Subtype /Image count:', imageXObjects)
console.log('PDF /XObject mentions:', xobjects)

if (imageXObjects < 1) {
  console.error('FAIL: PDF has no embedded images — OLE table likely still missing')
  process.exit(1)
}

console.log('PASS: OLE table rasterized and PDF contains embedded image(s)')
