from pathlib import Path
from fastapi import APIRouter, HTTPException, UploadFile
from pydantic import BaseModel, Field
from backend.app.core.dem_cache import dem_cache, resolve_dem

router = APIRouter(prefix="/dem", tags=["dem"])

class FetchDemRequest(BaseModel):
    north: float = Field(..., ge=-90, le=90)
    south: float = Field(..., ge=-90, le=90)
    east: float = Field(..., ge=-180, le=180)
    west: float = Field(..., ge=-180, le=180)

@router.get("/available")
async def list_available_dems():
    return {"dems": dem_cache.list_available()}

@router.post("/fetch")
async def fetch_dem(req: FetchDemRequest):
    cached = dem_cache.get_cached_path(req.north, req.south, req.east, req.west)
    if cached:
        return {"status": "cached", "path": str(cached)}
    from backend.app.core.dem_cache import _fetch_dem
    path = _fetch_dem(req.north, req.south, req.east, req.west)
    if path is None:
        raise HTTPException(502, "Failed to download DEM from OpenTopography")
    return {"status": "downloaded", "path": str(path)}

@router.post("/upload")
async def upload_dem(file: UploadFile):
    if not file.filename:
        raise HTTPException(400, "No file provided")
    ext = Path(file.filename).suffix
    if ext.lower() not in (".tif", ".tiff", ".asc", ".bil"):
        raise HTTPException(400, "Unsupported DEM format. Use .tif, .asc, or .bil")
    dest = dem_cache.store_path(0, 0, 0, 0, ext)
    content = await file.read()
    with open(dest, "wb") as f:
        f.write(content)
    return {"status": "uploaded", "path": str(dest)}
