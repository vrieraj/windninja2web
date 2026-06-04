from fastapi import APIRouter

router = APIRouter(prefix="/export", tags=["export"])

@router.get("/{task_id}/{fmt}")
async def export_simulation(task_id: str, fmt: str):
    pass
