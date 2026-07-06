"""
供应商相关工具
"""
from langchain.tools import tool
from app.common.client import client


@tool
async def search_supplier(name: str) -> str:
    """
    按名称搜索供应商。
    参数 name: 供应商名称关键词。
    """
    result = await client.get("/suppliers", params={"keyword": name})

    if result["code"] != 1:
        return f"查询失败: {result.get('msg', '未知错误')}"

    records = result["data"]["records"]
    total_count = result["data"]["total"]

    if total_count == 0:
        return f"未找到与 '{name}' 匹配的供应商"

    lines = [f"搜索 '{name}' 共找到 {total_count} 家供应商：\n"]
    for i, r in enumerate(records, 1):
        lines.append(
            f"{i}. {r['name']} | 联系人: {r.get('contact', '无')} | "
            f"电话: {r.get('phone', '无')} | 地址: {r.get('address', '无')}"
        )
    return "\n".join(lines)


@tool
async def get_supplier_detail(id: int) -> str:
    """
    根据 ID 查询供应商详细信息。
    参数 id: 供应商 ID。
    """
    result = await client.get(f"/suppliers/{id}")
    if result["code"] != 1:
        return f"查询失败: {result.get('msg', '未知错误')}"

    r = result["data"]
    if r is None:
        return f"未找到 ID 为 {id} 的供应商"

    return (
        f"供应商: {r['name']}\n"
        f"联系人: {r.get('contact', '无')}\n"
        f"电话: {r.get('phone', '无')}\n"
        f"地址: {r.get('address', '无')}\n"
        f"备注: {r.get('remark', '无')}"
    )
