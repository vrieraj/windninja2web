import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
import requests

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api", tags=["meteo"])

MODELS = {
    "ecmwf_ifs025": {
        "type": "forecast",
        "endpoint": "https://api.open-meteo.com/v1/forecast",
    },
    "gfs_seamless": {
        "type": "forecast",
        "endpoint": "https://api.open-meteo.com/v1/forecast",
    },
    "era5": {
        "type": "archive",
        "endpoint": "https://archive-api.open-meteo.com/v1/archive",
    },
}

HOURLY_VARS = "temperature_2m,cloud_cover,wind_speed_10m,wind_direction_10m"

class MeteoFetchRequest(BaseModel):
    lat: float = Field(..., ge=-90, le=90)
    lon: float = Field(..., ge=-180, le=180)
    model: str = Field(..., description="Model keyword: ecmwf_ifs025, gfs_seamless, era5")
    date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    hours: list[int] = Field(..., min_length=1)
    timezone: str = "UTC"

@router.post("/meteo/fetch")
async def fetch_meteo(req: MeteoFetchRequest):
    model_cfg = MODELS.get(req.model)
    if not model_cfg:
        raise HTTPException(400, f"Unknown model: {req.model}")

    params = {
        "latitude": req.lat,
        "longitude": req.lon,
        "hourly": HOURLY_VARS,
        "timezone": req.timezone,
        "start_date": req.date,
        "end_date": req.date,
        "models": req.model,
    }

    url = model_cfg["endpoint"]
    logger.info("Fetching Open-Meteo: %s model=%s date=%s", url, req.model, req.date)

    try:
        resp = requests.get(url, params=params, timeout=15)
    except requests.RequestException as e:
        logger.warning("Open-Meteo request failed: %s", e)
        return {"available": False, "reason": f"Connection error: {e}"}

    if resp.status_code != 200:
        logger.warning("Open-Meteo returned %d: %s", resp.status_code, resp.text[:200])
        return {"available": False, "reason": f"API returned code {resp.status_code}"}

    data = resp.json()
    if "error" in data:
        return {"available": False, "reason": data.get("reason", "Unknown Open-Meteo error")}

    hourly = data.get("hourly", {})
    times = hourly.get("time", [])
    temps = hourly.get("temperature_2m", [])
    clouds = hourly.get("cloud_cover", [])
    speeds = hourly.get("wind_speed_10m", [])
    dirs = hourly.get("wind_direction_10m", [])

    if not times:
        return {"available": False, "reason": "Model returned no hourly data for this date and location"}

    hours_set = set(req.hours)
    result = []
    for i, t in enumerate(times):
        try:
            h = int(t.split("T")[1].split(":")[0])
        except (IndexError, ValueError):
            continue
        if h in hours_set:
            result.append({
                "hour": h,
                "speed": round(speeds[i] / 3.6, 2) if i < len(speeds) and speeds[i] is not None else 0,
                "direction": round(dirs[i], 1) if i < len(dirs) and dirs[i] is not None else 0,
                "temp": round(temps[i], 1) if i < len(temps) and temps[i] is not None else 25,
                "cloud": round(clouds[i]) if i < len(clouds) and clouds[i] is not None else 0,
            })

    if not result:
        return {"available": False, "reason": f"No data for requested hours ({min(req.hours)}-{max(req.hours)})"}

    return {"available": True, "hourly": result}
