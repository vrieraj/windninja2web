import json
import tempfile
from pathlib import Path
import numpy as np
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from app.models.schemas import SimulationRequest, TimeseriesRequest
from app.core.task_manager import task_manager, TaskStatus
from app.core.ninja_bridge import SimulationConfig
from app.core.dem_cache import resolve_dem

router = APIRouter(prefix="/simulate", tags=["simulation"])

@router.post("/")
async def create_simulation(req: SimulationRequest):
    dem_path = resolve_dem(req.dem_source, req.north, req.south, req.east, req.west, req.dem_type)
    if dem_path is None:
        raise HTTPException(400, f"Cannot resolve DEM: {req.dem_source} ({req.dem_type})")

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
        non_neutral_stability=req.non_neutral_stability,
        air_temp=req.air_temp,
        cloud_cover=req.cloud_cover,
        year=req.year,
        month=req.month,
        day=req.day,
        hour=req.hour,
        minute=req.minute,
        time_zone=req.time_zone,
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

@router.get("/grid/{task_id}")
async def simulation_grid(task_id: str, index: int = Query(0, ge=0)):
    t = task_manager.get_status(task_id)
    if t is None:
        raise HTTPException(404, f"Task {task_id} not found")
    if t["status"] != TaskStatus.COMPLETED:
        raise HTTPException(400, f"Task status is {t['status']}")
    result = t["result"]
    if result is None:
        raise HTTPException(500, "No result data")

    if isinstance(result, list):
        if index >= len(result):
            raise HTTPException(400, f"Index {index} out of range ({len(result)} steps)")
        res = result[index]
    else:
        if index > 0:
            raise HTTPException(400, "Single simulation has only index 0")
        res = result

    step = max(1, res.nrows // 30, res.ncols // 30)
    features = []

    ct = None
    if res.projection:
        from osgeo import osr
        src_sr = osr.SpatialReference()
        src_sr.ImportFromWkt(res.projection)
        tgt_sr = osr.SpatialReference()
        tgt_sr.ImportFromEPSG(4326)
        tgt_sr.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        if not src_sr.IsSame(tgt_sr):
            ct = osr.CoordinateTransformation(src_sr, tgt_sr)

    for r in range(0, res.nrows, step):
        for c in range(0, res.ncols, step):
            spd = float(res.speed[r, c])
            if spd <= 0:
                continue
            x = res.xllcorner + (c + 0.5) * res.cell_size
            y = res.yllcorner + (r + 0.5) * res.cell_size
            if ct:
                lon, lat, _ = ct.TransformPoint(x, y)
            else:
                lon, lat = x, y
            features.append({
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {
                    "speed": round(spd, 2),
                    "direction": round(float(res.direction[r, c]), 1),
                },
            })
    return {"type": "FeatureCollection", "features": features}

@router.post("/timeseries")
async def create_timeseries(req: TimeseriesRequest):
    dem_path = resolve_dem(req.dem_source, req.north, req.south, req.east, req.west, req.dem_type)
    if dem_path is None:
        raise HTTPException(400, f"Cannot resolve DEM: {req.dem_source} ({req.dem_type})")

    task_id = task_manager.create_task()
    task_manager.run_timeseries(
        task_id, str(dem_path), req.speeds, req.directions,
        vegetation=req.vegetation, number_cpus=req.number_cpus,
        mesh_resolution=req.mesh_resolution,
        input_wind_height=req.input_wind_height,
        output_wind_height=req.output_wind_height,
        diurnal_winds=req.diurnal_winds,
        non_neutral_stability=req.non_neutral_stability,
        air_temp=req.air_temp, cloud_cover=req.cloud_cover,
        time_zone=req.time_zone,
        year=req.year, month=req.month,
        day=req.day, hour=req.hour,
    )
    return {"task_id": task_id}
