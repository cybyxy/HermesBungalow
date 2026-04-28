# PRD相关路由
from fastapi import APIRouter
import aiosqlite
from ..models.prd_model import PRDDoc

router = APIRouter(prefix="/api", tags=["PRD"])

# 种子数据
SEED_DOCS: list[dict] = [
    {"id": "1", "title": "PRD — 崽崽数字小屋 v1.2", "version": "v1.2", "date": "2026-04-28", "content": "..."},
    {"id": "2", "title": "IMPLEMENTATION_PLAN.md", "version": "v1.0", "date": "2026-04-28", "content": "..."},
]

@router.get("/prd")
async def list_prd():
    """获取PRD文档列表"""
    return [PRDDoc(**doc) for doc in SEED_DOCS]

@router.get("/prd/{doc_id}")
async def get_prd(doc_id: str):
    """获取单个PRD详情"""
    for doc in SEED_DOCS:
        if doc["id"] == doc_id:
            return PRDDoc(**doc)
    return {"error": "文档不存在"}

@router.post("/prd")
async def create_prd(doc: PRDDoc):
    """新增PRD文档"""
    SEED_DOCS.append(doc.model_dump())
    return {"status": "created", "id": doc.id}
