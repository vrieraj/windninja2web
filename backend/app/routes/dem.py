from fastapi import APIRouter

router = APIRouter(prefix="/dem", tags=["dem"])

@router.get("/available")
async def list_available_dems():
    pass

@router.post("/fetch")
async def fetch_dem():
    pass

@router.post("/upload")
async def upload_dem():
    pass
