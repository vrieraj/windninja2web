from fastapi import APIRouter

router = APIRouter(prefix="/simulate", tags=["simulation"])

@router.post("/")
async def create_simulation():
    pass

@router.get("/status/{task_id}")
async def simulation_status(task_id: str):
    pass

@router.get("/result/{task_id}")
async def simulation_result(task_id: str):
    pass

@router.post("/timeseries")
async def create_timeseries():
    pass
