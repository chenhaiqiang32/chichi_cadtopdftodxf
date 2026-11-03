const form = document.getElementById('convert-form') as HTMLFormElement
const fileInput = document.getElementById('file-input') as HTMLInputElement
const fileNameEl = document.getElementById('file-name') as HTMLSpanElement
const dropzone = document.getElementById('dropzone') as HTMLLabelElement
const submitBtn = document.getElementById('submit-btn') as HTMLButtonElement
const statusEl = document.getElementById('status') as HTMLDivElement
const resultEl = document.getElementById('result') as HTMLElement
const resultMeta = document.getElementById('result-meta') as HTMLParagraphElement
const downloadLink = document.getElementById('download-link') as HTMLAnchorElement
const previewBtn = document.getElementById('preview-btn') as HTMLButtonElement
const preview = document.getElementById('preview') as HTMLIFrameElement
const healthEl = document.getElementById('health') as HTMLSpanElement
const pdfOptions = document.getElementById('pdf-options') as HTMLDivElement
const dxfOptions = document.getElementById('dxf-options') as HTMLDivElement

let objectUrl: string | null = null
let lastTarget: 'pdf' | 'dxf' = 'pdf'

function selectedTarget(): 'pdf' | 'dxf' {
  const checked = form.querySelector('input[name="target"]:checked') as HTMLInputElement | null
  return checked?.value === 'dxf' ? 'dxf' : 'pdf'
}

function syncTargetUi() {
  const target = selectedTarget()
  pdfOptions.hidden = target !== 'pdf'
  dxfOptions.hidden = target !== 'dxf'
  previewBtn.hidden = target !== 'pdf'
  submitBtn.textContent = target === 'dxf' ? '转换为 DXF' : '转换为 PDF'
}

function setStatus(type: 'info' | 'error', text: string) {
  statusEl.hidden = false
  statusEl.className = `status ${type}`
  statusEl.textContent = text
}

function clearResult() {
  if (objectUrl) {
    URL.revokeObjectURL(objectUrl)
    objectUrl = null
  }
  resultEl.hidden = true
  preview.hidden = true
  preview.removeAttribute('src')
}

form.querySelectorAll('input[name="target"]').forEach((el) => {
  el.addEventListener('change', () => {
    syncTargetUi()
    clearResult()
  })
})

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0]
  fileNameEl.textContent = file ? file.name : ''
  clearResult()
})

;['dragenter', 'dragover'].forEach((eventName) => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault()
    dropzone.classList.add('dragover')
  })
})

;['dragleave', 'drop'].forEach((eventName) => {
  dropzone.addEventListener(eventName, (e) => {
    e.preventDefault()
    dropzone.classList.remove('dragover')
  })
})

dropzone.addEventListener('drop', (e) => {
  const dt = (e as DragEvent).dataTransfer
  const file = dt?.files?.[0]
  if (!file) return
  const ext = file.name.split('.').pop()?.toLowerCase()
  if (ext !== 'dwg' && ext !== 'dxf') {
    setStatus('error', '请选择 .dwg 或 .dxf 文件')
    return
  }
  const transfer = new DataTransfer()
  transfer.items.add(file)
  fileInput.files = transfer.files
  fileNameEl.textContent = file.name
  clearResult()
})

form.addEventListener('submit', async (e) => {
  e.preventDefault()
  const file = fileInput.files?.[0]
  if (!file) {
    setStatus('error', '请先选择文件')
    return
  }

  const target = selectedTarget()
  lastTarget = target
  clearResult()
  submitBtn.disabled = true
  setStatus('info', `正在转换为 ${target.toUpperCase()}：${file.name} …`)

  const body = new FormData()
  body.append('file', file)

  let endpoint = '/api/convert'
  if (target === 'pdf') {
    body.append('fit', (document.getElementById('fit') as HTMLSelectElement).value)
    body.append(
      'exportLayouts',
      String((document.getElementById('exportLayouts') as HTMLInputElement).checked)
    )
  } else {
    endpoint = '/api/convert-dxf'
    body.append('precision', (document.getElementById('precision') as HTMLInputElement).value)
    body.append('format', (document.getElementById('format') as HTMLSelectElement).value)
    body.append(
      'saveThumbnailImage',
      String((document.getElementById('saveThumbnailImage') as HTMLInputElement).checked)
    )
  }

  const started = performance.now()
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      body
    })

    if (!res.ok) {
      let message = `HTTP ${res.status}`
      try {
        const data = (await res.json()) as { message?: string; error?: string }
        message = data.message || data.error || message
      } catch {
        /* ignore */
      }
      throw new Error(message)
    }

    const blob = await res.blob()
    const serverMs = res.headers.get('X-Convert-Ms')
    const dxfFormat = res.headers.get('X-Dxf-Format')
    const elapsed = Math.round(performance.now() - started)
    objectUrl = URL.createObjectURL(blob)

    const base = file.name.replace(/\.(dwg|dxf)$/i, '') || 'drawing'
    const ext = target === 'dxf' ? 'dxf' : 'pdf'
    downloadLink.href = objectUrl
    downloadLink.download = `${base}.${ext}`
    downloadLink.textContent = `下载 ${ext.toUpperCase()}`

    previewBtn.hidden = target !== 'pdf'

    const formatHint =
      target === 'dxf' && dxfFormat ? ` · ${dxfFormat}` : ''
    resultMeta.textContent = `大小 ${(blob.size / 1024).toFixed(1)} KB${formatHint} · 客户端耗时 ${elapsed} ms${
      serverMs ? ` · 服务端 ${serverMs} ms` : ''
    }`
    resultEl.hidden = false
    setStatus('info', '转换成功')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    setStatus('error', `转换失败：${message}`)
  } finally {
    submitBtn.disabled = false
  }
})

previewBtn.addEventListener('click', () => {
  if (!objectUrl || lastTarget !== 'pdf') return
  preview.hidden = false
  preview.src = objectUrl
})

async function checkHealth() {
  try {
    const res = await fetch('/health')
    if (!res.ok) throw new Error(String(res.status))
    const data = (await res.json()) as { ok?: boolean; service?: string }
    healthEl.textContent = data.ok
      ? `服务正常 · ${data.service ?? 'cad-convert'}`
      : '服务异常'
  } catch {
    healthEl.textContent = '服务未连接（请先启动 server）'
  }
}

syncTargetUi()
checkHealth()
setInterval(checkHealth, 15000)
