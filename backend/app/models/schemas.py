from pydantic import BaseModel, Field
from typing import Optional, Literal

class SimulationRequest(BaseModel):
    dem_source: str = Field(..., description="DEM path or 'auto' to download")
    north: float = Field(..., ge=-90, le=90)
    south: float = Field(..., ge=-90, le=90)
    east: float = Field(..., ge=-180, le=180)
    west: float = Field(..., ge=-180, le=180)
    input_speed: float = Field(..., gt=0)
    input_direction: float = Field(..., ge=0, le=360)
    input_wind_height: float = 10.0
    output_wind_height: float = 10.0
    vegetation: str = "grass"
    diurnal_winds: bool = False
    mesh_resolution: float = 100.0
    output_speed_units: Literal["mps", "mph", "kph", "kts"] = "mps"
    number_cpus: int = 2

class TimeseriesRequest(BaseModel):
    dem_source: str
    north: float = Field(..., ge=-90, le=90)
    south: float = Field(..., ge=-90, le=90)
    east: float = Field(..., ge=-180, le=180)
    west: float = Field(..., ge=-180, le=180)
    speeds: list[float] = Field(..., min_length=1)
    directions: list[float] = Field(..., min_length=1)
    vegetation: str = "grass"
    mesh_resolution: float = 100.0
    number_cpus: int = 2

class ExportRequest(BaseModel):
    fmt: Literal["geotiff", "gpkg", "kmz", "ascii-zip", "pdf", "vtk"]
