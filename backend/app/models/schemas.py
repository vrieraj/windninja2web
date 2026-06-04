from pydantic import BaseModel
from typing import Optional

class SimulationRequest(BaseModel):
    dem_source: str
    north: float
    south: float
    east: float
    west: float
    input_speed: float
    input_direction: float
    input_wind_height: Optional[float] = 10.0
    vegetation: Optional[str] = "grass"
    diurnal_winds: Optional[bool] = False
    mesh_resolution: Optional[float] = 100.0
    number_cpus: Optional[int] = 2

class TimeseriesRequest(BaseModel):
    dem_source: str
    north: float
    south: float
    east: float
    west: float
    speeds: list[float]
    directions: list[float]
    timestamps: Optional[list[str]] = None
    vegetation: Optional[str] = "grass"

class ExportRequest(BaseModel):
    task_id: str
    fmt: str  # geotiff, gpkg, kmz, ascii-zip, pdf, vtk
