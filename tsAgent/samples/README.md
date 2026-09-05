# samples/ —— 解析 spike 的五类靶子（.gitignore 已排除入库，自己往里扔）

| # | 样本 | 验证什么 |
|---|------|----------|
| 1 | 数字版 SDS PDF | L0-direct：文字层直抽 + 16 分节切分 |
| 2 | 扫描件 SDS PDF | 无文字层 → L1-py-vl 全链路 |
| 3 | 带表格的 Word SOP | mammoth 表格序列化 + 假表格探测 |
| 4 | 双栏说明书 PDF | 栏间隙探测 + L0-column-sort 重排 |
| 5 | 纯图片页（GHS 标签/装置图） | image block + VL caption 占位 |

没有现成的就去试剂商官网下真 SDS（Sigma/Macklin 都有公开 PDF），用真文档做靶，别造玩具。
