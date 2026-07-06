"""
LangGraph 入口 —— 启动 agent 服务
    langgraph dev    → 开发模式
    langgraph up     → 生产模式
"""
import asyncio
from app.agent.reagent_assistant import agent, client
from dotenv import load_dotenv
import os

load_dotenv()

# ── 启动时自动登录后端 ──────────────────
async def _login():
    username = os.getenv("BACKEND_USERNAME")
    password = os.getenv("BACKEND_PASSWORD")
    if username and password:
        await client.login(username, password)

try:
    asyncio.run(_login())
except Exception as e:
    print(f"[warn] 后端登录失败，查询类工具暂不可用: {e}")

# LangGraph 识别的 graph 变量
graph = agent
