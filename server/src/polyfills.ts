/**
 * Browser API shims for Node:
 * - ProgressEvent: three.js FileLoader
 * - OffscreenCanvas / createImageBitmap / ImageData: OLE EMF→PNG via
 *   @mlightcad/emf-converter + @napi-rs/canvas
 */
import {
  createCanvas,
  loadImage,
  ImageData as NapiImageData,
  Image as NapiImage,
  Path2D as NapiPath2D,
  DOMMatrix as NapiDOMMatrix,
  type Canvas
} from '@napi-rs/canvas'

if (typeof (globalThis as { ProgressEvent?: unknown }).ProgressEvent === 'undefined') {
  class ProgressEventPolyfill extends Event {
    readonly lengthComputable: boolean
    readonly loaded: number
    readonly total: number
    constructor(type: string, eventInitDict: ProgressEventInit = {}) {
      super(type, eventInitDict)
      this.lengthComputable = Boolean(eventInitDict.lengthComputable)
      this.loaded = eventInitDict.loaded ?? 0
      this.total = eventInitDict.total ?? 0
    }
  }
  ;(globalThis as unknown as { ProgressEvent: typeof ProgressEvent }).ProgressEvent =
    ProgressEventPolyfill as unknown as typeof ProgressEvent
}

class OffscreenCanvasPolyfill {
  /** Unwrapped by @napi-rs/canvas drawImage (image._canvas / image.canvas). */
  readonly _canvas: Canvas

  constructor(width: number, height: number) {
    const w = Number.isFinite(width) ? Math.max(0, Math.floor(width)) : 300
    const h = Number.isFinite(height) ? Math.max(0, Math.floor(height)) : 150
    this._canvas = createCanvas(w, h)
  }

  get width(): number {
    return this._canvas.width
  }
  set width(value: number) {
    this._canvas.width = value
  }

  get height(): number {
    return this._canvas.height
  }
  set height(value: number) {
    this._canvas.height = value
  }

  get canvas(): Canvas {
    return this._canvas
  }

  getContext(type: string): ReturnType<Canvas['getContext']> | null {
    if (type !== '2d') return null
    return this._canvas.getContext('2d')
  }

  convertToBlob(options?: { type?: string; quality?: number }): Promise<Blob> {
    return this._canvas.convertToBlob(options)
  }
}

class ImageBitmapPolyfill {
  readonly width: number
  readonly height: number
  readonly _canvas: Canvas
  readonly canvas: Canvas

  constructor(canvas: Canvas) {
    this._canvas = canvas
    this.canvas = canvas
    this.width = canvas.width
    this.height = canvas.height
  }

  close(): void {
    // no-op; Canvas GC handles native resources
  }
}

async function createImageBitmapPolyfill(
  source: Blob | OffscreenCanvasPolyfill | ImageBitmapPolyfill | Canvas | { width?: number; height?: number }
): Promise<ImageBitmapPolyfill> {
  if (source instanceof OffscreenCanvasPolyfill) {
    return new ImageBitmapPolyfill(source._canvas)
  }
  if (source instanceof ImageBitmapPolyfill) {
    return new ImageBitmapPolyfill(source._canvas)
  }
  if (typeof Blob !== 'undefined' && source instanceof Blob) {
    const buffer = Buffer.from(await source.arrayBuffer())
    const img = await loadImage(buffer)
    const canvas = createCanvas(Math.max(1, img.width), Math.max(1, img.height))
    canvas.getContext('2d').drawImage(img, 0, 0)
    return new ImageBitmapPolyfill(canvas)
  }
  // Duck-type @napi-rs/canvas Canvas / CanvasElement
  const maybeCanvas = source as Canvas
  if (
    maybeCanvas &&
    typeof (maybeCanvas as { getContext?: unknown }).getContext === 'function' &&
    typeof (maybeCanvas as { width?: unknown }).width === 'number'
  ) {
    return new ImageBitmapPolyfill(maybeCanvas)
  }
  const w = Math.max(1, Math.floor((source as { width?: number }).width ?? 1))
  const h = Math.max(1, Math.floor((source as { height?: number }).height ?? 1))
  return new ImageBitmapPolyfill(createCanvas(w, h))
}

const g = globalThis as Record<string, unknown>

if (typeof g.OffscreenCanvas === 'undefined') {
  g.OffscreenCanvas = OffscreenCanvasPolyfill
}
if (typeof g.createImageBitmap === 'undefined') {
  g.createImageBitmap = createImageBitmapPolyfill
}
if (typeof g.ImageData === 'undefined') {
  g.ImageData = NapiImageData
}
if (typeof g.Image === 'undefined') {
  g.Image = NapiImage
}
if (typeof g.Path2D === 'undefined') {
  g.Path2D = NapiPath2D
}
if (typeof g.DOMMatrix === 'undefined') {
  g.DOMMatrix = NapiDOMMatrix
}

console.log(
  '[polyfills] @napi-rs/canvas ready — OffscreenCanvas=%s createImageBitmap=%s',
  typeof g.OffscreenCanvas,
  typeof g.createImageBitmap
)
