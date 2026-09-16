# fetch_sds.py —— 我的第一只爬虫：ILO ICSC 中文卡 → BioReagentMS 知识库
# 运行环境：本机 python（9/5 装过 pytools 那套，requests/bs4 都齐）
# ═══════════════════════════════════════════════════════════════
# 解剖学五层，对号入座看下面的函数：
#   ①任务源 collect_tasks()   —— card_id 0001~1785 硬枚举（官方列表页反而不用爬了，编号即清单）
#   ②取页面 fetch_card()      —— requests.Session ≈ OkHttpClient（连接复用+统一请求头）
#   ③解析   parse_card()      —— BeautifulSoup ≈ Jsoup（HTML→DOM树→CSS选择器取数）
#   ④清洗   card_to_md()      —— 结构化成 markdown 落盘（先留案底再投递）
#   ⑤投递+记账 submit()/state —— POST 本地 /ingest/upload + state.json 断点续爬（消费位点）
#
# 三种运行模式（"单步放大法"的工程化，每一档通过才进下一档）：
#   python fetch_sds.py dump icsc0002.html      # 第0课：离线侦察——把本地存的网页结构打出来，定选择器用
#   python fetch_sds.py one 0002                # 第1课：网络链路——真抓一张卡，走解析落盘，不投递
#   python fetch_sds.py run --limit 5           # 第2课：小批量——5张走完 抓取→入库 全链
#   python fetch_sds.py run                     # 第3课：放开跑（Ctrl+C 随时中断，重跑自动续位点）
# ═══════════════════════════════════════════════════════════════
import argparse
import json
import random
import re
import sys
import time
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# ── 常量区（配置和逻辑分开，改参数不碰函数）──
CARD_URL = "https://chemicalsafety.ilo.org/dyn/icsc/showcard.display?p_lang=zh&p_card_id={}&p_version=2"
CARD_RANGE = range(1, 1786)                       # 你侦察的结论：0001~1785 变号即全量
STAGING = Path(__file__).resolve().parent.parent / "data" / "icsc"   # 抓回的 md 案底
STATE = Path(__file__).resolve().parent.parent / "data" / "fetch_state.json"  # 消费位点
INGEST_URL = "http://localhost:8123/ingest/upload"  # 你自己的上传 API —— 爬虫只做采集，解析全交管线
HEADERS = {
    # ⚠️ 9/6 修：HTTP 头只许 latin-1，原中文 UA 会让 requests 直接 UnicodeEncodeError（fetch_biol 同款）
    # TODO: you@example.com 换成真实邮箱（实名 UA=被限速时站方能找着你，别裸奔）
    "User-Agent": "bioreagentms-student/1.0 (teaching project; contact: you@example.com)",
    "Accept-Language": "zh-CN,zh;q=0.9",
}


# ② 取页面 ─────────────────────────────────────────────
def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update(HEADERS)
    return s


def fetch_card(s: requests.Session, card_id: str) -> str:
    url = CARD_URL.format(card_id)
    r = s.get(url, timeout=30)
    # 铁律：被拒绝就整体熔断，绝不重试轰站（403=WAF/限速，429=明确的"你太快了"）
    if r.status_code in (403, 429):
        raise SystemExit(f"[熔断] HTTP {r.status_code} —— 检查 VPN 是否开着，或歇 10 分钟再来")
    r.raise_for_status()
    return r.text


# ③ 解析：页面 → 结构化 ────────────────────────────────
# ⚠️ 选择器全部待第0课（dump 本地 html）定完再填 —— 爬虫不猜 DOM，只看实物
SECTION_TITLE_RE = re.compile(r"^[\d.]+\s*[一-鿿]")   # 形如 "2. 物理危险" "4.3 急救措施"：识别"这是个分节行"


def parse_card(html: str) -> dict:
    """一张卡的 HTML → {name, cas, sections:[(标题, 正文), ...]}"""
    soup = BeautifulSoup(html, "html.parser")
    out = {"name": "", "cas": "", "sections": []}
    # 卡片标题：TODO(第0课) —— 大概率 <h1>/<title>，看 dump 输出定
    title = soup.select_one("h1") or soup.title
    if title:
        out["name"] = title.get_text(" ", strip=True)
    # CAS：TODO(第0课) —— ICSC 的 CAS 通常在摘要行或"鉴定"节
    m = re.search(r"(\d{2,7}-\d{2}-\d)", soup.get_text(" "))
    if m:
        out["cas"] = m.group(1)
    # 正文各节：TODO(第0课) —— 把 dump 里看到的表格/章节结构翻译成 select() 循环
    # 骨架先行（等实物 HTML 换真选择器）：
    for sec in soup.select("TABLE_TODO"):
        th = sec.find(["th", "b", "strong"])
        td = sec.find("td")
        if th and td and th.get_text(strip=True):
            out["sections"].append((th.get_text(" ", strip=True), td.get_text(" ", strip=True)))
    return out


# ④ 清洗：结构化 → markdown 文件（留案底）────────────────
def card_to_md(card_id: str, parsed: dict) -> str:
    lines = [f"# {parsed['name'] or 'ICSC ' + card_id}（ICSC {card_id}）", f"CAS：{parsed['cas'] or '未标注'}", ""]
    for title, body in parsed["sections"]:
        lines += [f"## {title}", body, ""]          # ## 分节标题正好喂 bySection 的 16 节锚
    return "\n".join(lines)


def sanitize(name: str) -> str:
    return re.sub(r'[<>:"/\\|?*（）()【】\s]+', "_", name).strip("_")[:60] or "unnamed"


# ⑤ 投递 + 记账 ────────────────────────────────────────
def load_state() -> set:
    return set(json.loads(STATE.read_text(encoding="utf-8")).get("done", [])) if STATE.exists() else set()


def save_state(done: set) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps({"done": sorted(done)}, ensure_ascii=False), encoding="utf-8")


def submit(path: Path) -> bool:
    """投给本地 Hono；202 = 入队成功（解析在服务端串行队列里异步进行，爬虫不等结果）"""
    with open(path, "rb") as f:
        r = requests.post(INGEST_URL, files={"file": (path.name, f, "text/markdown")}, data={"sub": "chemistry"}, timeout=30)  # sub=chemistry：化学卡落 corpus/chemistry/（与生物分家，9/6）
    body = r.json()
    ok = r.status_code == 202 and bool(body.get("accepted"))
    if not ok:
        print(f"  [投递被拒] {body}")
    return ok


# 第0课工具：离线侦察 —— 读你浏览器 Ctrl+S 存的文件，打印结构候选，我们据此定选择器
def dump_structure(html_path: str) -> None:
    html = Path(html_path).read_text(encoding="utf-8", errors="replace")  # 老页面编码杂，errors=replace 兜底
    soup = BeautifulSoup(html, "html.parser")
    print(f"== 文件 {html_path} | title: {soup.title.get_text(strip=True) if soup.title else '?'}")
    for tag in ("h1", "h2", "h3"):
        els = soup.find_all(tag)
        print(f"== <{tag}> ×{len(els)}: " + " | ".join(e.get_text(' ', strip=True)[:18] for e in els[:8]))
    tables = soup.find_all("table")
    print(f"== <table> ×{len(tables)}")
    for i, t in enumerate(tables[:6]):  # 前六个表各抽两行，找"标题格|内容格"的形态
        rows = t.find_all("tr")
        print(f"  table[{i}] rows={len(rows)} 首行: " + " ┃ ".join(c.get_text(' ', strip=True)[:20] for c in rows[0].find_all(['th', 'td'])[:4]) if rows else "  空表")
    # 分节标题命中测试：看看"2. 物理危险"这类字串都长在什么标签里
    hits = soup.find_all(string=SECTION_TITLE_RE)
    print(f"== 分节样式文本 ×{len(hits)}，宿主标签: " + ", ".join(sorted({h.parent.name for h in hits})))


# 主命令 ───────────────────────────────────────────────
def do_one(card_id: str) -> None:
    """第1课：全链单跑但不投递，肉眼看 md 质量"""
    html = fetch_card(make_session(), card_id)
    parsed = parse_card(html)
    print(f"name={parsed['name']} cas={parsed['cas']} sections={len(parsed['sections'])}")
    for t, b in parsed["sections"][:3]:
        print(f"  [{t}] {b[:60]}…")


def do_run(limit: int) -> None:
    """第2/3课：批量。已成卡跳过（位点驱动），单卡失败只记账不杀进程（旁路化同管线精神）"""
    STAGING.mkdir(parents=True, exist_ok=True)
    s = make_session()
    done = load_state()
    todo = [f"{i:04d}" for i in CARD_RANGE if f"{i:04d}" not in done]
    if limit:
        todo = todo[:limit]
    print(f"总 {len(CARD_RANGE)} 卡 | 已完成 {len(done)} | 本批 {len(todo)}")
    fail = []
    for n, card_id in enumerate(todo, 1):
        try:
            html = fetch_card(s, card_id)
            parsed = parse_card(html)
            if not parsed["sections"]:                      # 抓到壳但没解析出节 = 卡片结构变体或无中文版，留案底人工看
                (STAGING / f"EMPTY-{card_id}.html").write_text(html, encoding="utf-8")
                fail.append((card_id, "无分节"))
                continue
            path = STAGING / f"ICSC-{card_id}-{sanitize(parsed['name'])}.md"
            path.write_text(card_to_md(card_id, parsed), encoding="utf-8")
            if not submit(path):
                fail.append((card_id, "投递失败"))
                continue
            done.add(card_id)
            save_state(done)                                 # 成一单记一单：Ctrl+C 只丢当前这一张
            print(f"[{n}/{len(todo)}] ✓ {card_id} {parsed['name']}")
        except requests.RequestException as e:
            print(f"[{n}/{len(todo)}] ✗ {card_id} 网络: {str(e)[:60]}")  # 网络类失败不记位点：下轮重跑自动补
        time.sleep(1.5 + random.random())                    # 抖动间隔，比整点 sleep 更像人
    if fail:
        print("本批跳过清单（看 STAGING/EMPTY-*.html 找原因）:", fail)


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("dump"); p.add_argument("html")
    p = sub.add_parser("one"); p.add_argument("card_id")
    p = sub.add_parser("run"); p.add_argument("--limit", type=int, default=0)
    a = ap.parse_args()
    if a.cmd == "dump":
        dump_structure(a.html)
    elif a.cmd == "one":
        do_one(a.card_id)
    else:
        do_run(a.limit)


if __name__ == "__main__":
    main()
