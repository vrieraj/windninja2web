import os
import tempfile
import zipfile
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from fastapi import BackgroundTasks
from app.core.task_manager import task_manager, TaskStatus

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

# Formats that produce one file per simulation (timeseries -> zip of N files)
MULTI_FILE_FORMATS = {"geotiff", "pdf", "vtk"}

def _cleanup(path: str):
    try:
        os.unlink(path)
    except Exception:
        pass

@router.get("/{task_id}/{fmt}")
async def export_simulation(task_id: str, fmt: str, bg: BackgroundTasks):
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

        is_multi = isinstance(t.get("result"), list) and fmt in MULTI_FILE_FORMATS

        if is_multi:
            base, _ = os.path.splitext(output_path)
            to_clean = []
            zip_path = output_path + ".zip"
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
                i = 0
                while True:
                    p = f"{base}_{i:04d}{ext}"
                    if os.path.exists(p):
                        z.write(p, os.path.basename(p))
                        to_clean.append(p)
                        i += 1
                    else:
                        break
            to_clean.extend([output_path, zip_path])
            for p in to_clean:
                bg.add_task(_cleanup, p)
            return FileResponse(
                zip_path,
                media_type="application/zip",
                filename=f"windninja_{task_id[:8]}.zip",
            )

        bg.add_task(_cleanup, output_path)
        return FileResponse(
            output_path,
            media_type=MIME_MAP[fmt],
            filename=f"windninja_{task_id[:8]}{ext}",
        )
    except Exception as e:
        _cleanup(output_path)
        raise HTTPException(500, str(e))
