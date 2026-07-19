"""
LangGraph 入口 —— 启动 agent 服务
    langgraph dev    → 开发模式
    langgraph up     → 生产模式
"""
import asyncio, threading
from app.agent.reagent_assistant import agent, client
from dotenv import load_dotenv
import os

load_dotenv()

def _start_fastapi():
    import uvicorn
    from database import app
    uvicorn.run(app, host="127.0.0.1", port=8123, log_level="warning")

_thread = threading.Thread(target=_start_fastapi, daemon=True)
_thread.start()
print("[info] FastAPI 存储服务已启动 → http://127.0.0.1:8123")

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
