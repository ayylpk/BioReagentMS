import os, sqlite3
from dotenv import load_dotenv
from langchain.agents import create_agent
from langchain.chat_models import init_chat_model 
from langgraph.checkpoint.sqlite import SqliteSaver
from langchain.messages import HumanMessage
from app.common.tools import (
    search_reagent_stock, search_reagent_information,
    search_supplier, get_supplier_detail,
    query_inbound_records, query_outbound_records,
    query_warnings, count_unresolved_warnings,
    query_low_stock_top10, query_high_stock_top10,
    query_reagent_batches, get_batch_detail,
    query_operation_logs,
    search_local_knowledge,
    web_search_with_save,
)
from app.common.client import client

system_prompt = """
你是生物化学试剂实验室的智能助手。根据用户需求，按以下规则处理：

【查询试剂信息】
1. **优先调用 search_local_knowledge** 在本地知识库中搜索
   - 如果你能确定试剂 CAS 号，传入 cas_number 参数精确限定范围
   - 本地知识库的数据经过审核，比联网结果更可靠
2. 本地知识库未找到或信息不完整时，再调用 web_search 补充
3. 整理所有来源的信息，用清晰的结构输出（概述、性质、用途、注意事项等）
4. 如果用户同时关心库存，可以额外调用 search_reagent_stock

【查询实验室数据】
用户询问实验室内的试剂库存、批次、供应商、入库/出库记录、预警、操作日志时：
1. 判断用户意图，选择合适的工具查询
2. 根据查询结果直接回答，保持简洁，不要编造数据
3. 未找到时如实告知，不要道歉，直接说"未找到"

【修改/删除/新增操作】
用户试图修改实验室数据时，统一回复：
"为了保障数据安全与可追溯性，当前仅开放查询功能。如需修改请前往管理后台操作，或联系管理员。"

【工具选择参考】
- 试剂库存 → search_reagent_stock（按名称/CAS搜索）或 search_reagent_information（按ID查详情）
- 供应商 → search_supplier / get_supplier_detail
- 入库记录 → query_inbound_records
- 出库记录 → query_outbound_records
- 预警 → query_warnings / count_unresolved_warnings
- 库存排行 → query_low_stock_top10 / query_high_stock_top10
- 批号效期 → query_reagent_batches / get_batch_detail
- 操作日志 → query_operation_logs

【回复规范】
- 用 markdown 格式输出，善用标题、表格、列表让信息易读
- 工具返回的数据如实呈现，不要二次加工数值
- 工具返回文本中的换行符 \\n 需要转换为真正的换行，保证输出格式清晰
"""

load_dotenv()

model = init_chat_model(
    model = "deepseek-chat",
    api_key = os.getenv("DEEPSEEK_API_KEY"),
)
agent = create_agent(
    model = model,
    tools = [
        search_local_knowledge,
        web_search_with_save,
        search_reagent_stock, search_reagent_information,
        search_supplier, get_supplier_detail,
        query_inbound_records, query_outbound_records,
        query_warnings, count_unresolved_warnings,
        query_low_stock_top10, query_high_stock_top10,
        query_reagent_batches, get_batch_detail,
        query_operation_logs,
    ],
    system_prompt = system_prompt,
)

