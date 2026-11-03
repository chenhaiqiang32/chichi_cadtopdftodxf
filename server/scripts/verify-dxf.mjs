import '../src/polyfills.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { convertCadToDxf } from '../src/convert.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '../..')
const sample =
  process.argv[2] || path.join(root, 'samples/sample.dxf')
const out =
  process.argv[3] || path.join(root, 'samples/sample-out.dxf')

const buf = fs.readFileSync(sample)
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
const started = Date.now()
const result = await convertCadToDxf(ab, path.basename(sample), {
  precision: 6,
  format: 'ascii'
})
fs.writeFileSync(out, result.bytes)
const head = new TextDecoder()
  .decode(result.bytes.subarray(0, 120))
  .replace(/\r?\n/g, '|')
console.log(
  JSON.stringify(
    {
      ok: true,
      out,
      bytes: result.bytes.length,
      format: result.format,
      ms: Date.now() - started,
      head
    },
    null,
    2
  )
)
