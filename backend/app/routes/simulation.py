import json
import tempfile
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from backend.app.models.schemas import SimulationRequest, TimeseriesRequest
from backend.app.core.task_manager import task_manager, TaskStatus
from backend.app.core.ninja_bridge import SimulationConfig
from backend.app.core.dem_cache import resolve_dem

router = APIRouter(prefix="/simulate", tags=["simulation"])

@router.post("/")
async def create_simulation(req: SimulationRequest):
    dem_path = resolve_dem(req.dem_source, req.north, req.south, req.east, req.west)
    if dem_path is None:
        raise HTTPException(400, f"Cannot resolve DEM: {req.dem_source}")

    task_id = task_manager.create_task()
    config = SimulationConfig(
        dem_path=str(dem_path),
        input_speed=req.input_speed,
        input_direction=req.input_direction,
        input_wind_height=req.input_wind_height,
        output_wind_height=req.output_wind_height,
        vegetation=req.vegetation,
        mesh_resolution=req.mesh_resolution,
        number_cpus=req.number_cpus,
        output_speed_units=req.output_speed_units,
        diurnal_winds=req.diurnal_winds,
    )
    task_manager.run_simulation(task_id, config)
    return {"task_id": task_id}

@router.get("/status/{task_id}")
async def simulation_status(task_id: str):
    t = task_manager.get_status(task_id)
    if t is None:
        raise HTTPException(404, f"Task {task_id} not found")
    resp = {"task_id": task_id, "status": t["status"], "progress": t["progress"]}
    if t["error"]:
        resp["error"] = t["error"]
    return resp

@router.get("/result/{task_id}")
async def simulation_result(task_id: str):
    t = task_manager.get_status(task_id)
    if t is None:
        raise HTTPException(404, f"Task {task_id} not found")
    if t["status"] == TaskStatus.PENDING:
        raise HTTPException(400, "Task not started yet")
    if t["status"] == TaskStatus.RUNNING:
        raise HTTPException(400, "Task still running")
    if t["status"] == TaskStatus.FAILED:
        raise HTTPException(500, t["error"])
    result = t["result"]
    if result is None:
        raise HTTPException(500, "No result data")
    if isinstance(result, list):
        return {"type": "timeseries", "count": len(result), "task_id": task_id}
    return {
        "task_id": task_id,
        "type": "single",
        "nrows": result.nrows,
        "ncols": result.ncols,
        "cell_size": result.cell_size,
        "xllcorner": result.xllcorner,
        "yllcorner": result.yllcorner,
        "projection": result.projection,
    }

@router.post("/timeseries")
async def create_timeseries(req: TimeseriesRequest):
    if len(req.speeds) != len(req.directions):
        raise HTTPException(400, "speeds and directions must have same length")
    dem_path = resolve_dem(req.dem_source, req.north, req.south, req.east, req.west)
    if dem_path is None:
        raise HTTPException(400, f"Cannot resolve DEM: {req.dem_source}")

    task_id = task_manager.create_task()
    task_manager.run_timeseries(
        task_id, str(dem_path), req.speeds, req.directions,
        req.vegetation, req.number_cpus,
    )
    return {"task_id": task_id}
