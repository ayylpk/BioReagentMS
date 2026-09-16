# samples/ —— 解析靶子（.gitignore 已排除大件入库，自己往里扔真文档）

## 第一批：五类老靶子

| # | 样本 | 验证什么 |
|---|------|----------|
| 1 | 数字版 SDS PDF | L0-direct：文字层直抽 + 16 分节切分 |
| 2 | 扫描件 SDS PDF | 无文字层 → L1-py-vl 全链路 |
| 3 | 带表格的 Word SOP | mammoth 表格序列化 + 假表格探测 |
| 4 | 双栏说明书 PDF | 栏间隙探测 + L0-column-sort 重排 |
| 5 | 纯图片页（GHS 标签/装置图） | image block + VL caption 占位 |

没有现成的就去试剂商官网下真 SDS（Sigma/Macklin 都有公开 PDF），用真文档做靶，别造玩具。

## 第二批：解析泛化靶子（9/15 新增，**入库**，probe.test.ts 直接拿它们当断言对象）

这七个是"不知道会收到什么文档"这一条的回归网：每一族都要能在**没装任何第三方 Python 库**的环境里也抽得出内容。

| 文件 | 家族 | 验证什么 | 不装 markitdown/pymupdf 时 |
|------|------|----------|---------------------------|
| `family-html.html` | html | `<script>/<style>` 不得进正文；表格转管道表 | 落 `html-parser`（标准库）|
| `family-rtf.rtf` | rtf | 中文 `\uN?` 转义、`\par`、fonttbl/pict 噪声组剥离 | 落 `rtf-strip`（标准库）|
| `family-odt.odt` | odf | zip 内 `content.xml` 的 h/p/table | 一直就是标准库 |
| `family-pptx.pptx` | pptx | 每页标题占位符→heading，正文按段 | 落 `pptx-xml`（标准库）|
| `family-unknown.dat` | text | **陌生后缀 + 文本内容 → 内容嗅探兜底** | 标准库 |
| `family-gbk.txt` | text | GB18030 编码兜底（旧仪器的 txt 常是 GBK）| 标准库 |
| `family-table.csv` | text | csv/tsv → 管道表（不再当纯文本灌正文）| 标准库 |
| `family-text.pdf` | pdf | 有文字层 → pymupdf4llm，`pages_total` 进 diag | 需 pymupdf，缺则落手写 pdfjs |
| `family-scan.pdf` | pdf | 无文字层 → 前门判 `L1-py-vl` | — |
| `family-empty.dat` | unknown | 0 字节 → `unknown` + L2-review + "空文件"说明 | — |

改前门/解析层时先跑 `bun test src/rag/inspect/probe.test.ts`：它直接在读这些文件。
