"""
BioReagentMS 后端 API 客户端
—— 封装认证和 HTTP 请求，给 agent 工具用
"""
import os
import httpx
from typing import Optional


class BioReagentClient:
    """异步 HTTP 客户端，自动管理 JWT token"""

    def __init__(self):
        self.base_url = os.getenv("BACKEND_URL", "http://localhost:8080")
        self.token: Optional[str] = None
        self._username: Optional[str] = None
        self._password: Optional[str] = None

    async def login(self, username: str, password: str) -> str:
        """登录并缓存 token,之后所有请求自动携带"""
        self._username = username
        self._password = password
        async with httpx.AsyncClient() as client:
            r = await client.post(
                f"{self.base_url}/login",
                json={"username": username, "password": password},
            )
        data = r.json()
        if data["code"] != 1:
            raise RuntimeError(f"登录失败: {data.get('msg', '未知错误')}")
        self.token = data["data"]["accessToken"]
        return self.token # type: ignore

    async def _ensure_auth(self):
        """没有 token 就自动登录"""
        if not self.token and self._username:
            await self.login(self._username, self._password) # type: ignore


    async def request(
        self, method: str, path: str, params: dict = None, body: dict = None # type: ignore
    ) -> dict:
        """
        发送请求到后端，自动带 token。
        返回 {code, msg, data} 字典。
        """
        await self._ensure_auth()

        headers = {"token": self.token} if self.token else {}
        async with httpx.AsyncClient() as client:
            r = await client.request(
                method,
                f"{self.base_url}{path}",
                params=params,
                json=body,
                headers=headers,
            )
        if r.status_code == 401:
            raise RuntimeError("token 过期或未登录，请检查 BACKEND_USERNAME / BACKEND_PASSWORD")
        try:
            return r.json()
        except Exception:
            raise RuntimeError(f"后端返回非 JSON 格式 (HTTP {r.status_code}): {r.text[:200]}")

    async def get(self, path: str, params: dict = None) -> dict: # type: ignore
        return await self.request("GET", path, params=params)

    async def post(self, path: str, body: dict = None) -> dict: # type: ignore
        return await self.request("POST", path, body=body)

    async def put(self, path: str, body: dict = None) -> dict: # type: ignore
        return await self.request("PUT", path, body=body)

    async def delete(self, path: str, params: dict = None) -> dict: # type: ignore
        return await self.request("DELETE", path, params=params)
