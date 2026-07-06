"""
报表相关工具
"""
from langchain.tools import tool
from app.common.client import client


@tool
async def query_low_stock_top10() -> str:
    """查询库存最少的 10 种试剂（低库存预警）。"""
    result = await client.get("/report/top10/low")

    if result["code"] != 1:
        return f"查询失败: {result.get('msg', '未知错误')}"

    data = result["data"]
    if not data or not data.get("records"):
        return "暂无低库存数据"

    lines = ["库存最少的 10 种试剂：\n"]
    for i, r in enumerate(data["records"], 1):
        lines.append(
            f"{i}. {r.get('reagentName', r.get('name', '无'))} | "
            f"库存: {r.get('total', r.get('stock', 0))}"
        )
    return "\n".join(lines)


@tool
async def query_high_stock_top10() -> str:
    """查询库存最多的 10 种试剂。"""
    result = await client.get("/report/top10/high")

    if result["code"] != 1:
        return f"查询失败: {result.get('msg', '未知错误')}"

    data = result["data"]
    if not data or not data.get("records"):
        return "暂无库存数据"

    lines = ["库存最多的 10 种试剂：\n"]
    for i, r in enumerate(data["records"], 1):
        lines.append(
            f"{i}. {r.get('reagentName', r.get('name', '无'))} | "
            f"库存: {r.get('total', r.get('stock', 0))}"
        )
    return "\n".join(lines)
