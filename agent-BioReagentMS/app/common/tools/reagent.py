"""
试剂相关工具
"""
from langchain.tools import tool
from app.common.client import client


@tool
async def search_reagent_stock(name: str) -> str:
    """
    根据试剂名称或 CAS 号查询试剂库存。同一试剂可能有不同规格/纯度，会全部列出。
    参数 name: 试剂名称（如"氯化钠"）或 CAS 号（如"7647-14-5"）。
    """
    result = await client.get("/reagents/", params={"keyword": name})

    if result["code"] != 1:
        return f"查询失败: {result.get('msg', '未知错误')}"

    records = result["data"]["records"]
    total_count = result["data"]["total"]

    if total_count == 0:
        return f"未找到与 '{name}' 匹配的试剂"

    lines = [f"搜索 '{name}' 共找到 {total_count} 条匹配：\n"]
    for i, r in enumerate(records, 1):
        lines.append(
            f"{i}. {r['name']} | CAS: {r.get('casNumber', '无')} | "
            f"规格: {r.get('specification', '无')} | 纯度: {r.get('purity', '无')} | "
            f"库存: {r.get('total', 0)}{r.get('unit', '')} | "
            f"阈值: {r.get('safetyStockThreshold', 0)} | "
            f"存储: {r.get('storageCondition', '无')}"
        )
    return "\n".join(lines)


@tool
async def search_reagent_information(id: int) -> str:
    """
    根据试剂 ID 查询该试剂的详细信息。
    参数 id: 试剂 ID。
    """
    result = await client.get(f"/reagents/{id}")
    if result["code"] != 1:
        return f"查询失败: {result.get('msg', '未知错误')}"

    r = result["data"]

    if r is None:
        return f"未找到 ID 为 {id} 的试剂"

    return (
        f"试剂: {r['name']}\n"
        f"CAS号: {r.get('casNumber', '无')}\n"
        f"规格: {r.get('specification', '无')}\n"
        f"纯度: {r.get('purity', '无')}\n"
        f"库存总量: {r.get('total', 0)} {r.get('unit', '')}\n"
        f"存储条件: {r.get('storageCondition', '无')}\n"
        f"安全阈值: {r.get('safetyStockThreshold', 0)}"
    )
