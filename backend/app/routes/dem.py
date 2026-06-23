from pathlib import Path
from typing import Literal
from fastapi import APIRouter, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from app.core.dem_cache import dem_cache, resolve_dem, _fetch_dem, _reproject_to_utm, DEM_CACHE_DIR, generate_preview_png
import numpy as np

router = APIRouter(prefix="/dem", tags=["dem"])

class FetchDemRequest(BaseModel):
    north: float = Field(..., ge=-90, le=90)
    south: float = Field(..., ge=-90, le=90)
    east: float = Field(..., ge=-180, le=180)
    west: float = Field(..., ge=-180, le=180)
    dem_type: Literal["srtm", "alos", "cop30"] = "srtm"

@router.get("/available")
async def list_available_dems():
    return {"dems": dem_cache.list_available()}

@router.post("/fetch")
async def fetch_dem(req: FetchDemRequest):
    cached = dem_cache.get_cached_path(req.north, req.south, req.east, req.west, req.dem_type)
    if cached:
        utm_path = _reproject_to_utm(cached)
        return {"status": "cached", "path": str(utm_path), "dem_type": req.dem_type}
    path = _fetch_dem(req.north, req.south, req.east, req.west, req.dem_type)
    if path is None:
        raise HTTPException(502, f"Failed to download DEM ({req.dem_type}) from any source")
    utm_path = _reproject_to_utm(path)
    return {"status": "downloaded", "path": str(utm_path), "dem_type": req.dem_type}

import uuid as uuid_mod

@router.post("/upload")
async def upload_dem(file: UploadFile):
    if not file.filename:
        raise HTTPException(400, "No file provided")
    ext = Path(file.filename).suffix
    if ext.lower() not in (".tif", ".tiff", ".asc", ".bil"):
        raise HTTPException(400, "Unsupported DEM format. Use .tif, .asc, or .bil")
    if file.size and file.size > 100 * 1024 * 1024:
        raise HTTPException(400, "DEM file too large (max 100MB)")
    uid = str(uuid_mod.uuid4())[:8]
    dest = DEM_CACHE_DIR / f"upload_{uid}{ext}"
    content = await file.read()
    with open(dest, "wb") as f:
        f.write(content)
    return {"status": "uploaded", "path": str(dest)}

@router.get("/preview")
async def dem_preview(north: float, south: float, east: float, west: float,
                      dem_type: str = "srtm"):
    png_path = generate_preview_png(north, south, east, west, dem_type)
    if png_path is None:
        raise HTTPException(404, "DEM preview not available. Fetch DEM first via POST /dem/fetch")
    return FileResponse(str(png_path), media_type="image/png")

@router.get("/data")
async def dem_data(north: float, south: float, east: float, west: float,
                   dem_type: str = "srtm", max_cells: int = 250000):
    import logging
    logger = logging.getLogger(__name__)
    try:
        from osgeo import gdal, osr
        path = dem_cache.get_cached_path(north, south, east, west, dem_type)
        if path is None:
            raise HTTPException(404, "DEM not found. Fetch it first via POST /dem/fetch")
        utm_path = path.with_name(path.stem + "_utm.tif")
        if utm_path.exists():
            path = utm_path
        ds = gdal.Open(str(path))
        if ds is None:
            logger.error("gdal.Open failed for %s", path)
            raise HTTPException(500, "Failed to open DEM")
        gt = ds.GetGeoTransform()
        ncols_full = ds.RasterXSize
        nrows_full = ds.RasterYSize

        band = ds.GetRasterBand(1)
        if band is None:
            raise HTTPException(500, "DEM has no raster bands")

        if ncols_full * nrows_full > max_cells:
            scale = int((ncols_full * nrows_full / max_cells) ** 0.5) + 1
            buf_xs = max(1, ncols_full // scale)
            buf_ys = max(1, nrows_full // scale)
            data = band.ReadAsArray(0, 0, ncols_full, nrows_full, buf_xs, buf_ys)
            ncols = buf_xs
            nrows = buf_ys
            cellSize = gt[1] * scale
        else:
            data = band.ReadAsArray()
            ncols = ncols_full
            nrows = nrows_full
            cellSize = gt[1]

        if data is None:
            raise HTTPException(500, "Failed to read DEM raster data")

        elev = np.asarray(data, dtype=np.float32)

        nodata = band.GetNoDataValue()
        if nodata is not None:
            valid = elev != nodata
            if valid.any():
                elev[~valid] = elev[valid].min()

        proj_wkt = ds.GetProjection()
        is_projected = False
        if proj_wkt:
            try:
                srs = osr.SpatialReference()
                srs.ImportFromWkt(proj_wkt)
                is_projected = bool(srs.IsProjected())
            except Exception:
                pass

        ds = None
        return JSONResponse({
            "ncols": ncols,
            "nrows": nrows,
            "cellSize": cellSize,
            "xllCorner": gt[0],
            "yllCorner": gt[3],
            "elevations": elev.flatten().tolist(),
            "projection": proj_wkt,
            "is_projected": is_projected,
        })
    except HTTPException:
        raise
    except Exception as e:
        logger.error("dem_data error: %s", e, exc_info=True)
        raise HTTPException(500, f"DEM data error: {e}")
