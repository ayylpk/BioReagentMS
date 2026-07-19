import os
from contextlib import asynccontextmanager
from fastapi import FastAPI, Depends
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.ext.asyncio import async_sessionmaker, AsyncSession
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from datetime import datetime
from sqlalchemy import String, Text
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

ASYNC_DATABASE_URL = os.getenv(
    "ASYNC_DATABASE_URL",
    "mysql+aiomysql://root:password@localhost:3306/bioreagentms?charset=utf8mb4"
)

async_engine = create_async_engine(
    ASYNC_DATABASE_URL,
    echo = True,
    pool_size = 10,
    max_overflow = 10
)

class Base(DeclarativeBase):
    pass


class WebSearchResult(Base):
    __tablename__ = "web_search_result"

    id: Mapped[int] = mapped_column(primary_key=True, autoincrement=True, comment="编号")
    reagent_name: Mapped[str] = mapped_column(String(200), comment="试剂名")
    cas_number: Mapped[str] = mapped_column(String(100), comment="CAS号")
    content: Mapped[str] = mapped_column(Text(), comment="正文内容")
    create_time: Mapped[datetime] = mapped_column(default=datetime.now, comment="创建时间")


class WebSearchCreate(BaseModel):
    reagent_name: str
    cas_number: str
    content: str

async def createTables():
    async with async_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

async def dispose_engine():
    await async_engine.dispose()

@asynccontextmanager
async def lifespan(app: FastAPI):
    await createTables()
    yield
    await dispose_engine()

app = FastAPI(lifespan=lifespan)

AsyncSessionLocal = async_sessionmaker(
    bind = async_engine, 
    class_ = AsyncSession, 
    expire_on_commit = False 
)

async def getDatabase():
    async with AsyncSessionLocal() as db:
        try:
            yield db #返回数据库会话
            await db.commit() #提交事务
        except Exception:
            await db.rollback() #回滚
            raise

@app.post("/webSearch")
async def addWebSearch(data: WebSearchCreate, db: AsyncSession = Depends(getDatabase)):
    try:

        new_record = WebSearchResult(
            reagent_name=data.reagent_name,
            cas_number=data.cas_number,
            content=data.content,
        )
        
        db.add(new_record)
        
        await db.commit()
        
        await db.refresh(new_record)
        
        return {
            "code": 1,
            "msg": "新增成功",
            "data": {
                "id": new_record.id,
                "reagent_name": new_record.reagent_name,
                "cas_number": new_record.cas_number,
                "content": new_record.content,
                "create_time": new_record.create_time
            }
        }
    except Exception as e:
        return {
            "code": 0,
            "msg": f"新增失败: {str(e)}"
        }




@app.post("/webSearch/confirm")
async def confirmToChroma(data: WebSearchCreate):
    """将检索结果确认存入 Chroma 向量知识库"""
    try:
        from app.common.tools.knowledge import add_knowledge_batch
        ids = await add_knowledge_batch([{
            "cas_number": data.cas_number or "",
            "reagent_name": data.reagent_name,
            "category": data.cas_number or data.reagent_name,
            "content": data.content,
            "source": "web_search",
        }])
        return {"code": 1, "msg": "已存入知识库", "data": {"ids": ids}}
    except Exception as e:
        return {"code": 0, "msg": f"存入失败: {str(e)}"}

@app.delete("/webSearch/{id}")
async def deleteById(id: int, db: AsyncSession = Depends(getDatabase)):
    """确认存入知识库后，从检索结果表中删除"""
    from sqlalchemy import delete
    await db.execute(delete(WebSearchResult).where(WebSearchResult.id == id))
    await db.commit()
    return {"code": 1, "msg": "已删除"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8123)