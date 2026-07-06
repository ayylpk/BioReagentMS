"""
操作日志相关工具
"""
from langchain.tools import tool
from app.common.client import client


@tool
async def query_operation_logs(module: str = "") -> str:
    """
    查询操作日志。可按模块筛选（如 "试剂"、"入库"、"出库"），不传则查全部。
    参数 module: 模块名称（可选）。
    """
    params = {}
    if module:
        params["module"] = module
    result = await client.get("/operation/page", params=params)

    if result["code"] != 1:
        return f"查询失败: {result.get('msg', '未知错误')}"

    records = result["data"]["records"]
    total_count = result["data"]["total"]

    if total_count == 0:
        return f"未找到操作日志"

    lines = [f"操作日志共 {total_count} 条：\n"]
    for i, r in enumerate(records, 1):
        lines.append(
            f"{i}. {r.get('operationTime', '无')} | "
            f"模块: {r.get('module', '无')} | "
            f"操作: {r.get('type', '无')} | "
            f"操作人: {r.get('operatorName', '无')} | "
            f"详情: {r.get('detail', '无')}"
        )
    return "\n".join(lines)
