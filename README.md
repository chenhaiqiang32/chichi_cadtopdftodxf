# DWG / DXF → PDF · DXF 转换服务

基于 [MLightCAD](https://github.com/mlightcad/cad-viewer/tree/main/packages) 同源能力构建：

- 解析：`@mlightcad/libredwg-converter`（Node 主线程）+ `@mlightcad/data-model`
- PDF 导出：`@mlightcad/pdf-renderer` 的 `exportDatabaseToPdf`（与 [cad-pdf-plugin](https://github.com/mlightcad/cad-viewer/tree/main/packages/cad-pdf-plugin) 相同后端）
- DXF 导出：`AcDbDatabase.dxfOut`（与 [Script API `cad.file.saveDxf`](https://mlightcad.com/cad-viewer/docs/guide/script/api.html) / `AcApDxfConvertor` 相同路径）

## 目录

```
├── server/   # Express 转换 API
├── demo/     # Vite 前端测试页
└── package.json
```

## 快速开始

```bash
# 安装依赖（在仓库根目录）
npm install

# 终端 1：启动转换服务（默认 http://localhost:3100）
npm run dev:server

# 终端 2：启动前端 Demo（http://localhost:5173，已代理 /api）
npm run dev:demo
```

打开浏览器访问 http://localhost:5173 ，上传 `.dwg` / `.dxf`，选择输出 PDF 或 DXF。

## API

### `GET /health`

```json
{
  "ok": true,
  "service": "cad-convert",
  "version": "1.1.0",
  "endpoints": ["/api/convert", "/api/convert-dxf"]
}
```

### `POST /api/convert` → PDF

`multipart/form-data`：

| 字段 | 说明 |
|------|------|
| `file` | 必填，`.dwg` 或 `.dxf` |
| `fit` | 可选，`extents`（默认）或 `current` |
| `exportLayouts` | 可选，`true` / `false`，是否导出图纸空间布局页 |

成功时返回 `application/pdf`；响应头 `X-Convert-Ms` 为服务端耗时。

```bash
curl -X POST http://localhost:3100/api/convert \
  -F "file=@./sample.dwg" \
  -F "fit=extents" \
  -F "exportLayouts=false" \
  -o out.pdf
```

### `POST /api/convert-dxf` → DXF

对应官方 Script API [`cad.file.saveDxf`](https://mlightcad.com/cad-viewer/docs/guide/script/api.html)，底层调用 `database.dxfOut(undefined, precision, version, options)`。

`multipart/form-data`：

| 字段 | 说明 |
|------|------|
| `file` | 必填，`.dwg` 或 `.dxf` |
| `precision` | 可选，数值精度，默认 `6`（与 `AcApDxfConvertor` 一致） |
| `format` | 可选，`ascii`（默认）或 `binary` |
| `version` | 可选，目标 DXF 版本名/值（如 `AC1032`） |
| `saveThumbnailImage` | 可选，`true` / `false`，是否写入缩略图 |

成功时返回 `application/dxf`；响应头 `X-Convert-Ms`、`X-Dxf-Format`。

```bash
curl -X POST http://localhost:3100/api/convert-dxf \
  -F "file=@./sample.dwg" \
  -F "precision=6" \
  -F "format=ascii" \
  -o out.dxf
```

## 说明

- DWG 解析使用 LibreDWG WASM（GPL-3.0），通过 `@mlightcad/libredwg-converter/node` 的主线程转换器运行。
- DXF 读入由 `@mlightcad/data-model` 内置 MIT 转换器处理；DXF 写出走同一包的 `dxfOut`。
- **PDF 文字渲染**：`pdf-renderer` 在缺少 `glyphProvider` / 可嵌入字体时会丢弃 TEXT/MTEXT。本服务使用 `textMode: 'text'` + `@mlightcad/mtext-renderer` 字形回退。
- **字体只从 `server/fonts/` 加载**（`fonts.json` + 字体文件），不使用系统字体目录；DXF 导出不依赖字体文件。
- 生产环境建议限制上传大小、加鉴权与队列，避免大图并发打满内存。

## License

本仓库示例代码按 MIT 提供。依赖中的 LibreDWG 相关包为 GPL-3.0，分发时请自行遵守其许可要求。
