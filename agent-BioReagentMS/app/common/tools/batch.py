"""
批次相关工具
"""
from langchain.tools import tool
from app.common.client import client


@tool
async def query_reagent_batches(reagent_name: str = "") -> str:
    """
    查询试剂批次库存。可按试剂名称筛选，不传则查全部。
    参数 reagent_name: 试剂名称（可选）。
    """
    params = {}
    if reagent_name:
        params["reagentName"] = reagent_name
    result = await client.get("/reagentBatches", params=params)

    if result["code"] != 1:
        return f"查询失败: {result.get('msg', '未知错误')}"

    records = result["data"]["records"]
    total_count = result["data"]["total"]

    if total_count == 0:
        return f"未找到批次记录"

    lines = [f"批次记录共 {total_count} 条：\n"]
    for i, r in enumerate(records, 1):
        lines.append(
            f"{i}. {r.get('reagentName', '无')} | "
            f"批号: {r.get('batchNumber', '无')} | "
            f"库存: {r.get('stock', 0)} | "
            f"效期: {r.get('expiryDate', '无')} | "
            f"单价: {r.get('unitPrice', '无')}"
        )
    return "\n".join(lines)


@tool
async def get_batch_detail(id: int) -> str:
    """
    根据批次 ID 查询批次详细信息。
    参数 id: 批次 ID。
    """
    result = await client.get(f"/reagentBatches/{id}")
    if result["code"] != 1:
        return f"查询失败: {result.get('msg', '未知错误')}"

    r = result["data"]
    if r is None:
        return f"未找到 ID 为 {id} 的批次"

    return (
        f"试剂: {r.get('reagentName', '无')}\n"
        f"批号: {r.get('batchNumber', '无')}\n"
        f"库存: {r.get('stock', 0)}\n"
        f"单价: {r.get('unitPrice', '无')}\n"
        f"生产日期: {r.get('productionDate', '无')}\n"
        f"效期: {r.get('expiryDate', '无')}\n"
        f"存储位置: {r.get('storageLocation', '无')}"
    )
