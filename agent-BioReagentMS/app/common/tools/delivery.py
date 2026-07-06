"""
出库相关工具
"""
from langchain.tools import tool
from app.common.client import client


@tool
async def query_outbound_records(reagent_name: str = "") -> str:
    """
    查询出库记录。可按试剂名称筛选，不传则查全部。
    参数 reagent_name: 试剂名称（可选）。
    """
    params = {}
    if reagent_name:
        params["reagentName"] = reagent_name
    result = await client.get("/deliveryOrder", params=params)

    if result["code"] != 1:
        return f"查询失败: {result.get('msg', '未知错误')}"

    records = result["data"]["records"]
    total_count = result["data"]["total"]

    if total_count == 0:
        return f"未找到出库记录"

    lines = [f"出库记录共 {total_count} 条：\n"]
    for i, r in enumerate(records, 1):
        lines.append(
            f"{i}. 单号: {r.get('orderNumber', '无')} | "
            f"试剂: {r.get('reagentName', '无')} | "
            f"数量: {r.get('quantity', 0)} | "
            f"操作人: {r.get('operatorName', '无')} | "
            f"状态: {r.get('status', '无')}"
        )
    return "\n".join(lines)
