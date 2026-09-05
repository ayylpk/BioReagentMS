"""pytools/parse.py —— 文档解析主力（TS 侧 route 的 L0-py / L1-py-vl 策略 spawn 本脚本）

选型（9/5 拍板，深夜补 VL 桥）：
  PDF            → PyMuPDF4LLM；逐页判定，文字层空/稀的页**自动升级 qwen-vl-ocr 重解析**（混合文档救活）
  DOCX/PPTX/HTML → markitdown（微软官方）
  XLSX/XLS       → openpyxl  sheet 级：一 sheet 一原子块（行列关联不断）；台账型 sheet 拒收转 SQL
  PNG/JPG        → qwen-vl-ocr 直接整页解析
  TXT/MD/CSV     → 直读（md 语法顺带被 md_to_blocks 吃下）

依赖：pip install -r requirements.txt；VL 路要环境变量 DASHSCOPE_API_KEY（Bun 自动读 .env 并透传）
契约：stdout 最后一行 = {"blocks": [...], "reject": null|"..."}；日志走 stderr；非零码=失败
"""
import argparse
import base64
import hashlib
import json
import os
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HEADING_RE = re.compile(r"^(#{1,6})\s+(.*)$")
LEDGER_HINTS = {"试剂名称", "规格", "数量", "存放位置", "单价", "批号", "cas", "有效期", "供应商"}
SHEET_ROW_CAP = 500    # 巨表保险丝：超了截断并标注（真发生说明该走 SQL）
MIN_PAGE_CHARS = 20    # 页文字层低于这个数 → 视为扫描页，升 VL
VL_PAGE_CAP = 60       # 单次解析 VL 页数上限（成本闸：~¥0.01/页，封顶 60 页）

# ── 图转文（占位→并发描述→回填→再分块）的护栏 ──
MEDIA: Path = Path("./_parse_media")           # main() 里被 --media-dir 覆写
IMG_MIN_BYTES = 5 * 1024                        # <5KB 视为装饰线/页眉小图，直接丢引用
CAPTION_CAP = 20                                # 每文档最多描述几张图（成本闸）
MD_IMG_RE = re.compile(r"!\[([^\]\n]*)\]\(([^)\s]+)\)")
DATA_URI_RE = re.compile(r"!\[([^\]\n]*)\]\(data:image/([a-zA-Z+]+);base64,([A-Za-z0-9+/=]+)\)")

VL_PROMPT = (
    "提取本页全部文档内容，输出 markdown。要求："
    "1) 忠实转录，不总结、不改写、不遗漏任何文字；"
    "2) 表格：简单表输出 |md| 管道表，含合并单元格输出 <table> HTML，绝不允许拉平成段落；"
    "3) 标题层级用 # 表达；"
    "4) 只输出 markdown 本身，不要任何解释。"
)

CAPTION_PROMPT = (
    "描述这张文档插图：先给类型（GHS危险象形图/化学品标签/装置图/流程图/组织结构/照片/其他），"
    "再给关键信息；图中的文字要逐字转录。一两句中文，单行输出，只输出描述本身。"
)


def md_to_blocks(md: str, page: int | None = None) -> list[dict]:
    """markdown → Block[]：标题/表格整块/图片引用/段落（连续非空行合一）"""
    blocks: list[dict] = []
    lines = md.splitlines()
    i = 0
    while i < len(lines):
        s = lines[i].strip()
        if not s:
            i += 1
            continue
        h = HEADING_RE.match(s)
        if h:
            blocks.append({"type": "heading", "level": len(h.group(1)), "markdown": h.group(2).strip(), "page": page})
            i += 1
            continue
        if s.startswith("|"):
            buf: list[str] = []
            while i < len(lines) and lines[i].strip().startswith("|"):
                buf.append(lines[i].strip())
                i += 1
            blocks.append({"type": "table", "markdown": "\n".join(buf), "page": page})
            continue
        if s.startswith("![") or s.startswith("<img"):
            blocks.append({"type": "image", "markdown": s, "page": page})
            i += 1
            continue
        para: list[str] = []
        while i < len(lines):
            t = lines[i].strip()
            if not t or t.startswith("#") or t.startswith("|") or t.startswith("!["):
                break
            para.append(t)
            i += 1
        if para:
            blocks.append({"type": "text", "markdown": " ".join(para), "page": page})
    return blocks


# ─────────────────────────────────────────── qwen-vl-ocr 通道
FENCE_RE = re.compile(r"^```(?:markdown|md)?\s*\n([\s\S]*?)\n?```\s*$")

def strip_fences(md: str) -> str:
    """qwen-vl 常把'只输出markdown'执行成包一层 ```markdown 围栏——剥掉，防脏块入库"""
    t = md.strip()
    m = FENCE_RE.match(t)
    return m.group(1).strip() if m else t


def vl_image(png: bytes) -> str:
    """一页 PNG → markdown。没 key 就抛（TS 侧凭非零码走容灾/隔离，绝不静默）"""
    key = os.environ.get("DASHSCOPE_API_KEY", "")
    if not key:
        raise RuntimeError("缺 DASHSCOPE_API_KEY，VL 路不可用")
    import base64
    from openai import OpenAI
    client = OpenAI(api_key=key, base_url="https://dashscope.aliyuncs.com/compatible-mode/v1")
    res = client.chat.completions.create(
        model=os.environ.get("VL_MODEL", "qwen-vl-ocr-latest"),
        temperature=0.01,
        max_tokens=4096,
        messages=[{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(png).decode()}},
            {"type": "text", "text": VL_PROMPT},
        ]}],
    )
    return strip_fences(res.choices[0].message.content or "")


def vl_caption(png: bytes) -> str:
    """一张插图 → 一行描述（图转文用；与 vl_image 同通道不同任务）"""
    key = os.environ.get("DASHSCOPE_API_KEY", "")
    if not key:
        raise RuntimeError("缺 DASHSCOPE_API_KEY，图描述不可用")
    from openai import OpenAI
    client = OpenAI(api_key=key, base_url="https://dashscope.aliyuncs.com/compatible-mode/v1")
    res = client.chat.completions.create(
        model=os.environ.get("VL_MODEL", "qwen-vl-ocr-latest"),
        temperature=0.01,
        max_tokens=300,
        messages=[{"role": "user", "content": [
            {"type": "image_url", "image_url": {"url": "data:image/png;base64," + base64.b64encode(png).decode()}},
            {"type": "text", "text": CAPTION_PROMPT},
        ]}],
    )
    one_line = res.choices[0].message.content or "图片"
    return re.sub(r"\s+", " ", one_line).strip()[:160]  # 压成单行，防炸 md 段落判定


# hash → 描述 缓存：同一张 logo/水印跨页重复时只花一分钱（进程级）
_caption_cache: dict[str, str] = {}


def _caption_one(path: Path) -> str | None:
    """一张盘上图片 → 描述；太小=装饰返回 None"""
    try:
        raw = path.read_bytes()
    except OSError:
        return "图片(读取失败)"
    if len(raw) < IMG_MIN_BYTES:
        return None
    digest = hashlib.md5(raw).hexdigest()
    if digest in _caption_cache:
        return _caption_cache[digest]
    try:
        desc = vl_caption(raw)
    except Exception as e:
        print(f"[parse.py] caption 失败 {path.name}: {e}", file=sys.stderr)
        desc = "图片(描述失败)"
    _caption_cache[digest] = desc
    return desc


def caption_md(md: str) -> str:
    """图转文主流程：内联dataURI落盘 → 收集引用 → 并发VL描述 → 回填alt文本（位置不动，随后分块）"""
    MEDIA.mkdir(parents=True, exist_ok=True)

    # ① markitdown 常把小图塞成 data:image base64 URI —— 先落盘换成文件引用（库外统一按路径处理）
    def _dump_uri(m: re.Match) -> str:
        alt, ext, b64 = m.group(1), (m.group(2) or "png").replace("+xml", ""), m.group(3)
        try:
            blob = base64.b64decode(b64)
        except Exception:
            return ""  # 坏 URI 直接丢
        fname = MEDIA / f"emb-{hashlib.md5(blob).hexdigest()[:10]}.{ext}"
        if not fname.exists():
            fname.write_bytes(blob)
        return f"![{alt}]({fname})"
    md = DATA_URI_RE.sub(_dump_uri, md)

    # ② 收集去重后的图片引用
    refs = [m.group(2) for m in MD_IMG_RE.finditer(md)
            if not m.group(2).startswith(("http", "data:"))]
    uniq: list[str] = []
    for r in refs:
        if r not in uniq:
            uniq.append(r)
    if not uniq:
        return md
    todo = uniq[:CAPTION_CAP]
    if len(uniq) > len(todo):
        print(f"[parse.py] 图片 {len(uniq)} 张超上限，只描述前 {CAPTION_CAP} 张", file=sys.stderr)

    # ③ 并发描述（ThreadPool：VL 调用是网络 IO，4 路足够吃满配额前不惹眼）
    with ThreadPoolExecutor(max_workers=4) as pool:
        descs = list(pool.map(lambda p: _caption_one(Path(p)), todo))

    # ④ 回填：描述进 alt，位置原样保留；装饰小图（desc=None）整条引用抹掉
    lookup = dict(zip(todo, descs))
    def _backfill(m: re.Match) -> str:
        alt, target = m.group(1), m.group(2)
        if target in lookup:
            d = lookup[target]
            return "" if d is None else f"![{d or alt}]({target})"
        return m.group(0)  # 超上限没描述的：原引用带着走
    return MD_IMG_RE.sub(_backfill, md)


# ─────────────────────────────────────────── 各格式
def parse_pdf(path: Path) -> list[dict]:
    import pymupdf  # PyMuPDF（pymupdf4llm 的底座）
    import pymupdf4llm
    chunks = pymupdf4llm.to_markdown(str(path), page_chunks=True, write_images=True,
                                     image_path=str(MEDIA), image_format="png") or []
    doc = pymupdf.open(str(path))
    zoom = 150 / 72  # ~150dpi：VL 吃这个分辨率足够，再大白烧 token
    vl_used = 0
    blocks: list[dict] = []
    for pno in range(1, doc.page_count + 1):
        ch = chunks[pno - 1] if pno <= len(chunks) else {}
        text = (ch.get("text", "") if isinstance(ch, dict) else str(ch)).strip()
        if len(text) < MIN_PAGE_CHARS:  # 扫描页/乱码页 → 升 VL
            if vl_used >= VL_PAGE_CAP:
                print(f"[parse.py] p{pno} 超 VL 页数上限({VL_PAGE_CAP})，跳过", file=sys.stderr)
                continue
            pix = doc[pno - 1].get_pixmap(matrix=pymupdf.Matrix(zoom, zoom))
            try:
                text = vl_image(pix.tobytes("png"))
                vl_used += 1
                print(f"[parse.py] p{pno} 走 VL 路", file=sys.stderr)
            except Exception as e:
                print(f"[parse.py] p{pno} VL 失败: {e}", file=sys.stderr)
                text = ""
        blocks.extend(md_to_blocks(caption_md(text), pno))  # 页内插图先图转文，再进块化
    return blocks


def _restore_docx_media(path: Path, md: str) -> str:
    """markitdown 故意把 docx 图片吐成 `![](data:image/......)` 占位——真字节在 zip 的 word/media 里。
    按 document.xml 的 r:embed 引用顺序抠出落盘，逐个换回占位（位置不动），再进图转文管线。"""
    import zipfile
    try:
        with zipfile.ZipFile(path) as z:
            names = set(z.namelist())
            saved: list[Path] = []
            try:
                xml = z.read('word/document.xml').decode('utf-8', 'ignore')
                rels = z.read('word/_rels/document.xml.rels').decode('utf-8', 'ignore')
                rid2tgt = dict(re.findall(r'Id="(rId\d+)"[^>]*Target="(media/[^"]+)"', rels))
                ordered = [rid2tgt[r] for r in re.findall(r'r:embed="(rId\d+)"', xml) if r in rid2tgt]
            except KeyError:
                ordered = []
            if not ordered:  # 拿不到引用序就按文件名序兜底
                ordered = sorted(n.split('word/')[-1] for n in names if n.startswith('word/media/'))
            MEDIA.mkdir(parents=True, exist_ok=True)
            for tgt in ordered:
                full = f'word/{tgt}'
                if full not in names:
                    continue
                dest = MEDIA / Path(tgt).name
                dest.write_bytes(z.read(full))
                saved.append(dest)
    except Exception as e:
        print(f"[parse.py] docx 媒体抠图失败: {e}", file=sys.stderr)
        return md
    it = iter(saved)
    def _rep(m: re.Match) -> str:
        p = next(it, None)
        return m.group(0) if p is None else f"![{m.group(1)}]({p})"
    return re.sub(r'!\[([^\]\n]*)\]\(data:[^)]*\)', _rep, md)


def parse_office(path: Path) -> list[dict]:
    from markitdown import MarkItDown
    res = MarkItDown().convert(str(path))
    text = getattr(res, "markdown", None) or getattr(res, "text_content", "") or ""
    if path.suffix.lower() == '.docx':
        text = _restore_docx_media(path, text)
    return md_to_blocks(caption_md(text))  # 图转文同路：描述回填后才是分块的原料


def parse_image(path: Path) -> list[dict]:
    return md_to_blocks(vl_image(path.read_bytes()))


def parse_text(path: Path) -> list[dict]:
    return md_to_blocks(path.read_text(encoding="utf-8", errors="replace"))


def _cell(v) -> str:
    return str(v).replace("|", "\\|") if v is not None else ""


def parse_excel(path: Path) -> tuple[list[dict], str | None]:
    """逐 sheet：整表一个原子块（行列关联不破坏）；台账型拒绝"""
    import openpyxl
    wb = openpyxl.load_workbook(str(path), data_only=True, read_only=True)
    blocks: list[dict] = []
    rejected: list[str] = []
    for ws in wb.worksheets:
        rows = [[_cell(c) for c in r] for r in ws.iter_rows(values_only=True)
                if any(str(c).strip() not in ("", "None") for c in r)]
        if not rows:
            continue
        if len({c.strip().lower() for c in rows[0]} & LEDGER_HINTS) >= 3:
            rejected.append(ws.title)
            continue
        note = ""
        if len(rows) > SHEET_ROW_CAP:
            note = f"\n（超 {SHEET_ROW_CAP} 行已截断：这类大表请导入 MySQL 走 SQL 查询）"
            rows = rows[:SHEET_ROW_CAP]
        md_table = "\n".join([
            "| " + " | ".join(rows[0]) + " |",
            "|" + "---|" * len(rows[0]),
            *["| " + " | ".join(r) + " |" for r in rows[1:]],
        ]) + note
        blocks.append({"type": "heading", "level": 2, "markdown": f"工作表 {ws.title}"})
        blocks.append({"type": "table", "markdown": md_table})
    reject = f"台账型 sheet 拒入向量库（请走 MySQL）: {', '.join(rejected)}" if (rejected and not blocks) else None
    return blocks, reject


PARSERS = {
    ".pdf": lambda p: (parse_pdf(p), None),
    ".docx": lambda p: (parse_office(p), None),
    ".pptx": lambda p: (parse_office(p), None),
    ".html": lambda p: (parse_office(p), None),
    ".htm": lambda p: (parse_office(p), None),
    ".xlsx": parse_excel,
    ".png": lambda p: (parse_image(p), None),
    ".jpg": lambda p: (parse_image(p), None),
    ".jpeg": lambda p: (parse_image(p), None),
    ".txt": lambda p: (parse_text(p), None),
    ".md": lambda p: (parse_text(p), None),
    ".csv": lambda p: (parse_text(p), None),
}


def main() -> int:
    global MEDIA
    ap = argparse.ArgumentParser()
    ap.add_argument("--in", dest="infile", required=True)
    ap.add_argument("--media-dir", dest="media", default=None,
                    help="图转文的落盘目录（TS 侧传 resources/<docId>/media）")
    args = ap.parse_args()
    if args.media:
        MEDIA = Path(args.media)
    path = Path(args.infile)
    entry = PARSERS.get(path.suffix.lower())
    if not entry:
        print(json.dumps({"blocks": [], "reject": f"不支持的格式 {path.suffix}"}, ensure_ascii=False))
        return 2
    try:
        result = entry(path)
        blocks, reject = (result[0], result[1]) if isinstance(result, tuple) else (result, None)
    except Exception as e:
        print(f"[parse.py] 解析失败 {path.name}: {e}", file=sys.stderr)
        print(json.dumps({"blocks": [], "reject": None}))
        return 2
    print(f"[parse.py] {path.name}: blocks={len(blocks)} reject={reject or '无'}", file=sys.stderr)
    print(json.dumps({"blocks": blocks, "reject": reject}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
