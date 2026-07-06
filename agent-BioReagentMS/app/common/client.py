"""
共享的 API 客户端实例 —— 所有工具模块共用同一个 client
"""
from app.agent.api_client import BioReagentClient

client = BioReagentClient()
