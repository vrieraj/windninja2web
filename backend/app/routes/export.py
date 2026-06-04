import tempfile
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from backend.app.core.task_manager import task_manager, TaskStatus
from backend.app.models.schemas import ExportRequest

router = APIRouter(prefix="/export", tags=["export"])

MIME_MAP = {
    "geotiff": "image/tiff",
    "gpkg": "application/geopackage+sqlite3",
    "kmz": "application/vnd.google-earth.kmz",
    "ascii-zip": "application/zip",
    "pdf": "application/pdf",
    "vtk": "application/octet-stream",
}

EXT_MAP = {
    "geotiff": ".tif",
    "gpkg": ".gpkg",
    "kmz": ".kmz",
    "ascii-zip": ".zip",
    "pdf": ".pdf",
    "vtk": ".vtk",
}

@router.get("/{task_id}/{fmt}")
async def export_simulation(task_id: str, fmt: str):
    if fmt not in MIME_MAP:
        raise HTTPException(400, f"Unsupported format: {fmt}. Use: {', '.join(MIME_MAP.keys())}")
    t = task_manager.get_status(task_id)
    if t is None:
        raise HTTPException(404, f"Task {task_id} not found")
    if t["status"] != TaskStatus.COMPLETED:
        raise HTTPException(400, f"Task status is {t['status']}, not completed")

    ext = EXT_MAP[fmt]
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
        output_path = f.name

    try:
        task_manager.export(task_id, fmt, output_path)
        return FileResponse(
            output_path,
            media_type=MIME_MAP[fmt],
            filename=f"windninja_{task_id[:8]}{ext}",
        )
    except Exception as e:
        raise HTTPException(500, str(e))
