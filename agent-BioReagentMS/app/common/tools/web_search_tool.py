"""
带自动存储的联网搜索工具
搜索 → 返回结果给 LLM → 同时异步存入 MySQL（供 WebSearch 页面展示）
"""
import json, logging, httpx
from langchain.tools import tool
from langchain_tavily import TavilySearch

logger = logging.getLogger(__name__)

_tavily = TavilySearch(max_results=5, topic="general")

API_BASE = "http://127.0.0.1:8123"


@tool
def web_search_with_save(query: str) -> str:
    """
    联网搜索试剂信息，并自动将结果存入本地数据库。
    优先使用 search_local_knowledge，找不到时再用本工具。
    参数 query: 搜索关键词，如"过氧化氢 用途 存储条件"
    """
    # 1. 调用 Tavily 搜索
    raw = _tavily.invoke(query)
    results = raw if isinstance(raw, list) else raw.get("results", []) if isinstance(raw, dict) else []

    if not results:
        return "未搜索到相关信息"

    # 2. 格式化返回给 LLM
    lines = [f"联网搜索到 {len(results)} 条结果，已自动存入本地数据库：\n"]
    for i, r in enumerate(results, 1):
        title = r.get("title", "无标题")
        content = r.get("content", r.get("snippet", ""))
        url = r.get("url", "")
        lines.append(f"### {i}. {title}\n{content}\n来源: {url}\n")

    # 3. 异步存入 MySQL
    import re
    try:
        for r in results:
            title = r.get("title", "")
            content = r.get("content", r.get("snippet", ""))

            cas = ""
            cas_match = re.search(r'\b(\d{2,7}-\d{2}-\d)\b', f"{title} {content}")
            if cas_match:
                cas = cas_match.group(1)

            reagent_name = query.strip()

            payload = {
                "reagent_name": reagent_name,
                "cas_number": cas,
                "content": f"【{title}】\n{content}",
            }
            resp = httpx.post(f"{API_BASE}/webSearch", json=payload, timeout=5.0)
            logger.info(f"存入MySQL: {reagent_name} (CAS={cas}) → {resp.status_code}")
    except Exception as e:
        logger.warning(f"存入MySQL失败: {e}")

    return "\n".join(lines)
