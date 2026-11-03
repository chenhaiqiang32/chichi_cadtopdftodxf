# 字体目录（唯一字体来源）

转换服务**只**从此目录加载字体，不会读取系统 `Windows/Fonts`。

| 文件 | 作用 |
|------|------|
| `fonts.json` | 字体目录（逻辑名 / 文件名 / mesh\|shx） |
| `*.ttf` / `*.otf` / `*.woff` | 可嵌入 PDF 的轮廓字体（textMode） |
| `*.shx` | AutoCAD 形字体（由 mtext-renderer 矢量化） |

启动时会按 `fonts.json` 将本目录下存在的字体全部注册到 FontManager。
若 catalog 中写的是 `simsun.woff` 但同名 `simsun.ttf` 也存在，嵌入 PDF 时优先使用 `.ttf`。
