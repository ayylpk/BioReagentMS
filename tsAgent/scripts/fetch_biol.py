# fetch_biol.py —— 第二只爬虫：碧云天(Beyotime)生物试剂说明书 → BioReagentMS 知识库
# 运行环境：本机 python（requests/bs4 同 fetch_sds 那套）
# ═══════════════════════════════════════════════════════════════
# 为什么是碧云天（9/6 勘察实录，别信记忆要信 curl）：
#   · 生物试剂没有 ICSC 这种"官方编号卡站"，退而求其次选厂商：产品线全（菌株/细胞/抗体/
#     试剂盒/酶），中文说明书，正是 BioReagentMS 库存里管的那批货
#   · 老 ASP 站=纯服务端渲染：类目页 330KB 静态 HTML、无分页、单页最多 393 个产品全量内联
#   · 编号即清单：/product/{货号}.htm（D0337=BL21甘油菌），和 ICSC 的 card_id 一个味道
#   · 类目树 goods.do?method=getallcplist 一把梭：556 个 12 位叶子码，前缀 001=生物试剂(384叶)
#     002仪器/003耗材/004化学(ICSC已覆盖) 都不要——爬前缀 001
#   · 两个坑（都实测踩过）：①产品页第一步只回 266B 的 meta-refresh 壳+种 JSESSIONID cookie，
#     带 cookie 二次请求才有正文（浏览器会自己重发，curl -L 不会——requests 要手动补第二枪）
#                    ②编码混杂：首页 gb2312、内页多为 utf-8，按 meta charset 嗅探解码
#
# 五层解剖学（对照 fetch_sds 看，③④⑤是换皮，①②是本级特有）：
#   ①任务源 build_inventory() —— 类目树→384类目页→货号清单 biol_inventory.json（先数清楚再爬）
#   ②取页面 fetch_html()      —— Session 两步握手过 JSESSIONID 门 + 编码嗅探
#   ③解析   parse_product()   —— cpinfo1=简介(+保存/注意/清单 strong 锚) cpinfo2=使用说明
#   ④清洗   card_to_md()      —— 分节 markdown；价格剔除（铁律：值类字段进 MySQL 不进向量库）
#   ⑤投递   submit()+state    —— POST :8123/ingest/upload，断点续爬
#
# 课程模式（fetch_sds 同款节奏）：
#   python fetch_biol.py inventory                 # 第0课：建清单（只碰类目页，约15分钟，产出规模报告）
#   python fetch_biol.py one D0337                 # 第1课：单件全链不投递，肉眼看 md
#   python fetch_biol.py run --limit 5             # 第2课：小批量走 /ingest 全链（要后端服务在线）
#   python fetch_biol.py run [--branch 001005]     # 第3课：放开跑；--branch 可按二级前缀只爬某板块
# ═══════════════════════════════════════════════════════════════
import argparse
import json
import random
import re
import sys
import threading
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import requests
from bs4 import BeautifulSoup

# ── 常量区 ─────────────────────────────────────────────
BASE = "https://www.beyotime.com"
CATE_TREE_URL = f"{BASE}/goods.do?method=getallcplist&flag=1"   # 556 叶子类目一把出
LIST_URL = BASE + "/goods.do?method=lcode&lcode={}"              # 单类目页（全量产品内联，无分页）；.format 填充，别用 f-string（{} 空占位符不是合法表达式）
PROD_URL = f"{BASE}/product/{{}}.htm"                           # 货号即 URL
BIO_PREFIX = "001"                                              # 只要生物试剂树
STAGING = Path(__file__).resolve().parent.parent / "data" / "beyotime"
INVENTORY = Path(__file__).resolve().parent.parent / "data" / "biol_inventory.json"
STATE = Path(__file__).resolve().parent.parent / "data" / "biol_state.json"
INGEST_URL = "http://localhost:8123/ingest/upload"
HEADERS = {
    # ⚠️ HTTP 头只许 latin-1 字符——中文 UA 会直接 UnicodeEncodeError（fetch_sds 同款雷，9/6 一跑就炸）
    # TODO: 把 you@example.com 换成你真实邮箱——实名 UA 是爬虫礼貌三件套之一（被限速时站方能联系到你）
    "User-Agent": "bioreagentms-student/1.0 (teaching project; contact: you@example.com)",
    "Accept-Language": "zh-CN,zh;q=0.9",
}


# ② 取页面：Session + 两步握手 + 编码嗅探 ────────────────
def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update(HEADERS)
    s.get(BASE + "/", timeout=30)   # 先逛首页把 JSESSIONID 种上（≈ OkHttpClient 先热身拿 CookieJar）
    return s


def decode(raw: bytes) -> str:
    """老站编码随缘：认 meta charset 声明，gb2312/gbk 一律按 gb18030 解（它的超集），兜底 utf-8"""
    m = re.search(rb'charset=["\']?([A-Za-z0-9-]+)', raw[:3000], re.I)
    enc = (m.group(1).decode() if m else "utf-8").lower()
    if enc in ("gb2312", "gbk", "gb-2312"):
        enc = "gb18030"
    try:
        return raw.decode(enc, errors="replace")
    except LookupError:
        return raw.decode("utf-8", errors="replace")


def fetch_html(s: requests.Session, url: str) -> str:
    """带三种页面形态的自适应取页（9/6 夜实测：碧云天 WAF 吃软不吃硬）：
    ①壳页(266B meta-refresh) = 刚种 cookie，浏览器会重发，我们照做
    ②验证码页(271KB，HTTP 200) = 被限速，梯度回退 15/30/45…分钟后再来——绝不硬闯
    ③正常页 = 收工返回"""
    for attempt in range(6):
        r = s.get(url, timeout=30)
        if r.status_code in (403, 429):
            raise SystemExit(f"[熔断] HTTP {r.status_code} —— 歇 10 分钟再来，或检查 VPN")
        r.raise_for_status()
        raw = r.content
        if len(raw) < 1000 and b"refresh" in raw:          # ① 壳页：cookie 已种，立即重发同一 URL（不占回退预算）
            r = s.get(url, timeout=30)
            raw = r.content
        txt = decode(raw)
        if "验证码" in txt[:3000]:                          # ② WAF 墙：等它消气。⚠️ 9/6 实测是 IP 级软封（清 cookie 也没用），
            # 且冷却以小时计——退避必须狠：30/60/90/120/180/240 分钟，宁可整夜磨也要蹭过冷却窗自动续爬，绝不硬闯
            wait = 1800 + 1800 * attempt                    # 30→60→90→120→150→180... 递增封顶看下方 min
            wait = min(wait, 240 * 60)
            print(f"[限速] 出验证码了（IP级冷却），歇 {wait // 60} 分钟再试（第 {attempt + 1}/6 轮）", flush=True)
            time.sleep(wait)
            continue
        return txt                                          # ③ 正文
    raise SystemExit("[熔断] 连吃 6 轮验证码（约 5 小时）——WAF 拉黑升级，停手明日再看")


# ① 任务源：类目树 → 类目页 → 货号清单 ──────────────────
def leaf_categories(s: requests.Session) -> dict:
    """{lcode: 叶子类目名}，只留前缀 001 的生物试剂树"""
    txt = fetch_html(s, CATE_TREE_URL)
    out = {}
    for code, name in re.findall(r'lcode=([0-9]{12})[^>]*>\s*([^<]{1,40}?)\s*<', txt):
        if code.startswith(BIO_PREFIX) and name.strip():
            out[code] = name.strip()
    return out


def collect_products(s: requests.Session, lcode: str) -> list:
    """类目页 → [(货号, 品名, 包装), ...]。实物 DOM 已解剖：
    <td id="D0337"> + <a href="/product/D0337.htm" class="td_a_10">品名</a> + <td style="word-wrap...">200μl</td>"""
    soup = BeautifulSoup(fetch_html(s, LIST_URL.format(lcode)), "html.parser")
    rows = []
    for a in soup.select('a[href^="/product/"][class*=td_a]'):
        code = a["href"].split("/product/")[1].rsplit(".htm", 1)[0]
        name = a.get_text(" ", strip=True)
        pack = ""
        cell = a.find_parent("td")                      # 品名格的下一格是包装（Jsoup nextElementSibling 的等价物）
        if cell:
            nxt = cell.find_next_sibling("td")
            if nxt:
                pack = nxt.get_text(" ", strip=True)
        if name:
            rows.append((code, name, pack))
    return rows


def build_inventory() -> None:
    s = make_session()
    leaves = leaf_categories(s)
    print(f"生物试剂叶子类目：{len(leaves)} 个，逐类目收产品（每页约 300KB，别急）…")
    inv = {}
    for i, (lcode, lname) in enumerate(sorted(leaves.items()), 1):
        try:
            rows = collect_products(s, lcode)
        except requests.RequestException as e:
            print(f"  [{i}/{len(leaves)}] ✗ {lname} 网络失败: {str(e)[:50]}（不记清单，重跑补）")
            continue
        for code, name, pack in rows:
            if code in inv:
                continue                                 # 同货号挂多个类目，首见即得
            inv[code] = {"name": name, "pack": pack, "lcode": lcode, "lname": lname}
        print(f"  [{i}/{len(leaves)}] ✓ {lname} +{len(rows)}")
        time.sleep(1.2 + random.random())
    INVENTORY.parent.mkdir(parents=True, exist_ok=True)
    INVENTORY.write_text(json.dumps(inv, ensure_ascii=False), encoding="utf-8")
    # 规模报告：按二级板块分组数数，决定第3课要不要 --branch 圈地
    by_branch = defaultdict(int)
    by_name = defaultdict(set)
    for k, v in inv.items():
        by_branch[f"{v['lcode'][:6]} {v['lname']}"] += 1
        by_name[v["name"]].add(k)                        # 同名多货号 = 包装规格变体（S/M/L）；注意货号在字典键里不在值里（KeyError 血泪）
    print(f"\n== 清单完毕：{len(inv)} 货号 | 去重同名变体后约 {len(by_name)} 篇独立说明书")
    print("== 板块分布（货号数）:")
    for b, n in sorted(by_branch.items(), key=lambda kv: -kv[1]):
        print(f"   {n:5d}  {b}")


# ③④ 解析+清洗：产品页 → 分节 markdown ───────────────────
def parse_product(code: str, html: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    out = {"code": code, "name": "", "pack": "", "sections": []}

    # 标题：<title>碧云天生物技术-BL21(DE3)甘油菌(蛋白诱导表达菌株)(D0337)
    # 尾部括号恒为货号（第1课实测规格拿错就是这坑）；规格从类目清单带过来，不从标题抢
    t = soup.title.get_text(strip=True) if soup.title else ""
    m = re.match(r"碧云天生物技术-(.+?)\(([^)]*)\)\s*$", t)
    if m:
        out["name"] = m.group(1)
        if m.group(2) != code:                            # 万一某页尾括号真不是货号（非标品），才当规格收
            out["pack"] = m.group(2)
    elif t:
        out["name"] = t
    # 品名兜底：正文里 <td id=货号> 旁也有一份
    if not out["name"]:
        cell = soup.select_one(f'td[id="{code}"]')
        a = (cell.find_next_sibling("td") or soup).find("a") if cell else None
        out["name"] = a.get_text(" ", strip=True) if a else code

    def grab(el, label):
        txt = el.get_text("\n", strip=True)
        txt = re.sub(r"\n{2,}", "\n", txt)
        if len(txt) > 10:
            out["sections"].append((label, txt))

    cp1 = soup.select_one("div.beyotimeProductExt#cpinfo1")
    cp2 = soup.select_one("div.beyotimeProductExt#cpinfo2")
    if cp1:
        # 简介区里藏着 strong 小锚（保存条件/注意事项/包装清单）：
        # 偷懒但稳妥的做法=整块收下交给 bySection——我们的 ## 标题喂得动它，别在爬虫里造第二套分节器
        grab(cp1, "产品简介")
    if cp2:
        grab(cp2, "使用说明")
    # 产品文件：说明书 PDF 只记名字和链接（PDF 本体将来按 doc_id 增量补，不做爬虫职责扩张）
    pdfs = [a for a in soup.select('a[href$=".pdf"]')][:8]
    if pdfs:
        lines = "\n".join(f"- {a.get_text(' ', strip=True)}: {BASE}{a['href']}" for a in pdfs)
        out["sections"].append(("产品文件（说明书 PDF，未入库）", lines))
    # 价格：故意不抓 —— 值类字段（价格/库存）进 MySQL 不进向量库（9/4 分流铁律）
    return out


def sanitize(name: str) -> str:
    return re.sub(r'[<>:"/\\|?*（）()【】\s]+', "_", name).strip("_")[:60] or "unnamed"


def card_to_md(p: dict, inv_rec: dict | None) -> str:
    head = f"# {p['name']}（碧云天 {p['code']}）"
    pack = p["pack"] or (inv_rec or {}).get("pack", "")   # 规格优先解析值，缺则用类目清单带来的
    lines = [head] + ([f"规格：{pack}"] if pack else []) + [""]
    for title, body in p["sections"]:
        lines += [f"## {title}", body, ""]
    return "\n".join(lines)


# ⑤ 投递 + 记账 ────────────────────────────────────────
WITH_LIB = False   # main() 里按 --with-lib 置真：默认剔"库"类模板说明书
def load_state() -> set:
    return set(json.loads(STATE.read_text(encoding="utf-8")).get("done", [])) if STATE.exists() else set()


def save_state(done: set) -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps({"done": sorted(done)}, ensure_ascii=False), encoding="utf-8")


def submit(path: Path) -> bool:
    """同 fetch_sds：202=入队，解析在 Hono 串行队列里异步做，爬虫不等结果
    sub=bio：服务端落盘 corpus/bio/（化学/生物分家，9/6 用户拍板）"""
    with open(path, "rb") as f:
        r = requests.post(INGEST_URL, files={"file": (path.name, f, "text/markdown")}, data={"sub": "bio"}, timeout=30)
    body = r.json()
    ok = r.status_code == 202 and bool(body.get("accepted"))
    if not ok:
        print(f"  [投递被拒] {body}")
    return ok


# 第0课工具 ─────────────────────────────────────────────
def dump_structure(html_path: str) -> None:
    html = Path(html_path).read_text(encoding="utf-8", errors="replace")
    soup = BeautifulSoup(html, "html.parser")
    print(f"== {html_path} | title: {soup.title.get_text(strip=True) if soup.title else '?'}")
    for d in soup.select("div.beyotimeProductExt"):
        print(f"  容器 id={d.get('id')} len={len(d.get_text(' ', strip=True))} head={d.get_text(' ', strip=True)[:60]!r}")
    for st in soup.select("strong")[:15]:
        print(f"  strong 锚: {st.get_text(' ', strip=True)[:24]!r}")
    pdfs = soup.select('a[href$=".pdf"]')
    print(f"  PDF 链接 ×{len(pdfs)}: " + " | ".join(a.get_text(' ', strip=True)[:16] for a in pdfs[:5]))


def do_one(code: str) -> None:
    """第1课：单件全链（抓取+解析+落盘案底），不投递。看 md 质量用"""
    s = make_session()
    p = parse_product(code, fetch_html(s, PROD_URL.format(code)))
    print(f"name={p['name']} pack={p['pack']} sections={[t for t, _ in p['sections']]}")
    md = card_to_md(p, None)
    STAGING.mkdir(parents=True, exist_ok=True)
    path = STAGING / f"BEYOTIME-{code}-{sanitize(p['name'])}.md"
    path.write_text(md, encoding="utf-8")
    print(f"已落盘 {path}\n---- 前 800 字 ----\n{md[:800]}")


def do_run(limit: int, branch: str) -> None:
    """第2/3课：批量。清单驱动 + 位点续爬 + 同名变体去重（同品名只爬首见货号）
    默认只爬生物四板块（菌株/细胞/检测/抗体）且剔"库"类模板件；--branch 可换圈法，--with-lib 放宽
    ⚠️ 9/6 夜血泪：曾改 4 并发(≈2 req/s)，第 30 件起被 WAF 验证码墙糊脸、白烧万次请求——
    厂商老站守串口姿势：一次一件 + 1.8~2.7s 抖动；验证码退避逻辑在 fetch_html 内置"""
    if not INVENTORY.exists():
        raise SystemExit("先跑 `python fetch_biol.py inventory` 建清单（第0课）")
    inv = json.loads(INVENTORY.read_text(encoding="utf-8"))
    BIO_BRANCHES = ("001001", "001003", "001004", "001005")   # 菌株载体/细胞/检测/抗体；001002多肽 001006/8 化学 都不要
    want = tuple(b.strip() for b in branch.split(",") if b.strip()) or BIO_BRANCHES
    s = make_session()
    done = load_state()
    seen_names: set = set()
    for code, rec in inv.items():                              # 位点里已完成的品名先入去重池（续跑折叠口径不裂）
        if rec["lcode"][:6] in want and code in done:
            seen_names.add(rec["name"])
    todo = []
    for code, rec in inv.items():
        if rec["lcode"][:6] not in want or code in done:
            continue
        if not WITH_LIB and ('库' in rec["lname"] or '库' in rec["name"]):
            continue                                           # 基因编辑库/细胞库等：说明书模板化，信息密度低
        if rec["name"] in seen_names:                          # D0007S/M/L 这种包装变体：说明书同一份，爬一次就够
            continue
        seen_names.add(rec["name"])
        todo.append((code, rec))
    if limit:
        todo = todo[:limit]
    print(f"清单 {len(inv)} | 板块 {','.join(want)} | 已爬 {len(done)} | 本批 {len(todo)}（同名变体已折叠）", flush=True)
    STAGING.mkdir(parents=True, exist_ok=True)
    fail: list = []
    for n, (code, rec) in enumerate(todo, 1):
        try:
            html = fetch_html(s, PROD_URL.format(code))        # 验证码退避可能让单件卡几十分钟——是设计不是卡死
            p = parse_product(code, html)
            if not p["sections"]:
                (STAGING / f"EMPTY-{code}.html").write_text(html, encoding="utf-8")
                fail.append((code, "无内容"))
                continue
            path = STAGING / f"BEYOTIME-{code}-{sanitize(p['name'])}.md"
            path.write_text(card_to_md(p, rec), encoding="utf-8")
            if not submit(path):
                fail.append((code, "投递失败"))
                continue
            done.add(code)
            save_state(done)                                    # 成一单记一单：Ctrl+C 只丢当前这一张
            if n <= 5 or n % 25 == 0:
                print(f"[{n}/{len(todo)}] ✓ {code} {p['name']}", flush=True)  # 一万件别刷屏，25 件一报
        except requests.RequestException as e:
            print(f"[{n}/{len(todo)}] ✗ {code} 网络: {str(e)[:60]}", flush=True)  # 网络失败不记位点，重跑自动补
        time.sleep(0.5 + random.random() * 0.5)                 # 含抓取 ~2.3s/件 ≈ 0.45 req/s：比出事的 2 req/s 慢 4 倍，和 ICSC 1785 件平安档同量级
    if fail:
        print("本批跳过清单(前20):", fail[:20], "…" if len(fail) > 20 else "")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("inventory")
    p = sub.add_parser("dump"); p.add_argument("html")
    p = sub.add_parser("one"); p.add_argument("code")
    p = sub.add_parser("run"); p.add_argument("--limit", type=int, default=0); p.add_argument("--branch", default=""); p.add_argument("--with-lib", action="store_true", help="连'库'类模板说明书一起爬（默认剔）")
    a = ap.parse_args()
    if a.cmd == "inventory":
        build_inventory()
    elif a.cmd == "dump":
        dump_structure(a.html)
    elif a.cmd == "one":
        do_one(a.code)
    else:
        global WITH_LIB
        WITH_LIB = a.with_lib
        do_run(a.limit, a.branch)


if __name__ == "__main__":
    main()
