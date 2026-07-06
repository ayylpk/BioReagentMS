"""
预警相关工具
"""
from langchain.tools import tool
from app.common.client import client


@tool
async def query_warnings(status: int = 0) -> str:
    """
    查询预警记录。参数 status: 0=未处理（默认）, 1=已处理。
    """
    result = await client.get("/warning/list", params={"status": status})

    if result["code"] != 1:
        return f"查询失败: {result.get('msg', '未知错误')}"

    records = result["data"]["records"]
    total_count = result["data"]["total"]

    if total_count == 0:
        label = "未处理" if status == 0 else "已处理"
        return f"暂无{label}预警"

    label = "未处理" if status == 0 else "已处理"
    lines = [f"{label}预警共 {total_count} 条：\n"]
    for i, r in enumerate(records, 1):
        lines.append(
            f"{i}. {r.get('reagentName', '无')} | "
            f"类型: {r.get('warningType', '无')} | "
            f"内容: {r.get('content', '无')} | "
            f"时间: {r.get('createTime', '无')}"
        )
    return "\n".join(lines)


@tool
async def count_unresolved_warnings() -> str:
    """
    查询未处理预警的数量（导航栏红点数）。
    """
    result = await client.get("/warning/count")

    if result["code"] != 1:
        return f"查询失败: {result.get('msg', '未知错误')}"

    count = result["data"]
    return f"当前未处理预警: {count} 条"
