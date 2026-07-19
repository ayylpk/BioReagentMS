"""
试剂知识库 —— Chroma 向量存储 + 本地 Embedding
每个试剂的知识拆成独立卡片，按 CAS 号索引，支持语义搜索和精确过滤
"""

import os, chromadb
from pathlib import Path
from langchain.tools import tool
from dotenv import load_dotenv
from chromadb.utils.embedding_functions import OllamaEmbeddingFunction
load_dotenv()

CHROMA_PATH = Path(__file__).resolve().parent.parent.parent.parent / "resources" / "chroma"
CHROMA_PATH.mkdir(parents=True, exist_ok=True)

EMBEDDING_MODEL = os.getenv("EMBEDDING_MODEL", "BAAI/bge-large-zh-v1.5")

to_embedding = OllamaEmbeddingFunction(
    model_name="modelscope.cn/gpustack/bge-m3-GGUF:latest",
    url="http://localhost:11434"
)

_chroma_client=chromadb.PersistentClient(path=str(CHROMA_PATH))

_collection = _chroma_client.get_or_create_collection(
    name = "regent_knowledge",
    embedding_function = to_embedding, # type: ignore
    metadata={"description":"试剂知识卡片库,按照CAS号索引"}
)

@tool
def search_local_knowledge(query: str, cas_number: str) -> str:
    """
    在本地试剂知识库中搜索。优先使用此工具，找不到再联网搜索。
    参数query:自然语言问题。如"氯化钠的存储条件"
    参数 cas_number:CAS号(可选),传入后课精确限定只搜该试剂的知识卡片。不传则在全部试剂中搜索。
    """

    where_filter = None
    if cas_number:
        where_filter = {"cas_number":cas_number}

    results = _collection.query(
        query_texts=[query],
        n_results=3,
        where=where_filter, # type: ignore
        include=["documents","metadatas","distances"]
    )

    documents = results.get("documents" or [[]])[0] # type: ignore
    metadata = results.get("metadatas" or [[]])[0]  # type: ignore
    distances = results.get("distances" or [[]])[0]  # type: ignore

    if not documents:
        return "本地知识库未找到相关信息"

    lines = [f"从本地知识库找到{len(documents)}条相关信息:\n"]
    for i, (doc, meta, dist) in enumerate(zip(documents, metadata, distances), 1):
        similarity = max(0, 1 - dist) 
        lines.append(
            f"### 结果 {i} | {meta.get('name', '未知试剂')} | "
            f"分类: {meta.get('category', '无')} |相关度: {similarity:.0%}\n"
            f"{doc}\n"
        )

    return "\n".join(lines)


async def add_knowledge_batch(items: list[dict]) -> list[str]:
    """
    批量添加知识卡片。items 中每个字典需包含:
    cas_number, reagent_name, content, category[, source]
    返回所有分配的 doc_id。
    """
    ids = []
    docs = []
    metas = []
    for item in items:
        cas = item["cas_number"]
        cat = item["category"]
        existing = _collection.get(
            where={"$and": [{"cas_number": cas}, {"category": cat}]}
        )
        seq = len(existing.get("ids", [])) + 1
        doc_id = f"{cas}_{cat}_{seq}"

        ids.append(doc_id)
        docs.append(item["content"])
        metas.append({
            "cas_number": cas,
            "name": item["reagent_name"],
            "category": cat,
            "source": item.get("source", "manual"),
            "verified": False,
        })

    _collection.add(ids=ids, documents=docs, metadatas=metas)
    return ids







