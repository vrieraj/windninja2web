"""
Bridge between Python and the C++ WindNinja core via pybind11.
Provides high-level Simulation and TimeSeries wrappers.
"""

import os
import sys
import logging
from pathlib import Path
import numpy as np
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

# Boost date_time uses IANA timezone names.
# "Etc/UTC" is the canonical name for UTC in the Olson database.
_TZ_MAP = {
    "UTC": "Etc/UTC",
    "utc": "Etc/UTC",
    "GMT": "Etc/GMT",
    "gmt": "Etc/GMT",
}

def _map_timezone(tz: str) -> str:
    return _TZ_MAP.get(tz, tz)

_core = None

def _load_core():
    global _core
    if _core is not None:
        return _core
    import sys
    lib_dir = Path(__file__).resolve().parent.parent.parent / "lib" / "build"
    if lib_dir.exists() and str(lib_dir) not in sys.path:
        sys.path.insert(0, str(lib_dir))
    try:
        import windninja_core
        _core = windninja_core
        _init_windninja()
        return _core
    except ImportError as e:
        raise RuntimeError(
            "windninja_core module not found. "
            f"Searched in {lib_dir} but could not import."
        ) from e


def _init_windninja():
    """Initialize WindNinja internals (timezone DB, etc.)."""
    wn_data = Path(__file__).resolve().parent.parent.parent.parent / "data"
    csv_path = wn_data / "date_time_zonespec.csv"
    if not csv_path.exists():
        logger.warning("WindNinja data dir %s has no date_time_zonespec.csv", wn_data)
        return

    # Try full NinjaInitialize first (needs GDAL_DATA)
    try:
        from osgeo import gdal
        gdal_data = gdal.GetConfigOption("GDAL_DATA") or os.environ.get("GDAL_DATA")
        if not gdal_data:
            for p in ["/usr/share/gdal", "/usr/local/share/gdal"]:
                if (Path(p) / "gdalicon.png").exists():
                    gdal_data = p
                    break
        if gdal_data and (Path(gdal_data) / "gdalicon.png").exists():
            ret = _core.initialize(str(gdal_data), str(wn_data))
            logger.info("NinjaInitialize returned %d", ret)
            return
        logger.info("GDAL_DATA not found, loading timezone DB directly")
    except Exception as exc:
        logger.warning("NinjaInitialize failed: %s, falling back to direct timezone load", exc)

    # Fallback: load timezone DB directly
    _core.load_timezone_db(str(csv_path))
    logger.info("Timezone DB loaded from %s", csv_path)


@dataclass
class SimulationConfig:
    dem_path: str
    input_speed: float = 5.0
    input_direction: float = 270.0
    input_wind_height: float = 10.0
    vegetation: str = "grass"
    mesh_resolution: float = 100.0
    number_cpus: int = 2
    output_speed_units: str = "mps"
    output_wind_height: float = 10.0
    diurnal_winds: bool = False
    non_neutral_stability: bool = False
    air_temp: Optional[float] = None
    cloud_cover: Optional[float] = None
    year: Optional[int] = None
    month: Optional[int] = None
    day: Optional[int] = None
    hour: Optional[int] = None
    minute: int = 0
    second: int = 0
    time_zone: str = "UTC"


@dataclass
class SimulationResult:
    speed: np.ndarray
    direction: np.ndarray
    projection: str
    cell_size: float
    xllcorner: float
    yllcorner: float
    ncols: int
    nrows: int
    vel_filename: str
    ang_filename: str


class NinjaSession:
    """A single WindNinja simulation."""

    def __init__(self):
        self._core = _load_core()
        self._ninja = self._core.Ninja()
        self._configured = False

    def configure(self, config: SimulationConfig):
        n = self._ninja

        n.set_DEM(config.dem_path)
        n.set_initializationMethod(self._core.InitMethod.domainAverage)
        n.set_inputSpeed(config.input_speed, self._core.VelocityUnits.mps)
        n.set_inputDirection(config.input_direction)
        n.set_inputWindHeight(config.input_wind_height, self._core.LengthUnits.meters)

        veg_map = {"grass": self._core.Vegetation.grass,
                    "brush": self._core.Vegetation.brush,
                    "trees": self._core.Vegetation.trees}
        n.set_uniVegetation(veg_map.get(config.vegetation, self._core.Vegetation.grass))

        n.set_meshResolution(config.mesh_resolution, self._core.LengthUnits.meters)
        n.set_numVertLayers(20)
        n.set_numberCPUs(config.number_cpus)
        n.set_outputWindHeight(config.output_wind_height, self._core.LengthUnits.meters)

        vunits_map = {"mps": self._core.VelocityUnits.mps,
                      "mph": self._core.VelocityUnits.mph,
                      "kph": self._core.VelocityUnits.kph,
                      "kts": self._core.VelocityUnits.kts}
        n.set_outputSpeedUnits(vunits_map.get(config.output_speed_units,
                                               self._core.VelocityUnits.mps))

        n.keepOutputGridsInMemory(True)
        n.set_position()

        if config.diurnal_winds:
            n.set_diurnalWinds(True)

        if config.non_neutral_stability:
            n.set_stabilityFlag(True)

        if config.diurnal_winds or config.non_neutral_stability:
            if config.air_temp is not None:
                n.set_uniAirTemp(config.air_temp, self._core.TempUnits.C)
            if config.cloud_cover is not None:
                n.set_uniCloudCover(config.cloud_cover, self._core.CoverUnits.percent)
            if config.year is not None:
                tz = _map_timezone(config.time_zone)
                n.set_date_time(
                    config.year, config.month, config.day,
                    config.hour, config.minute, config.second,
                    tz)

        self._configured = True

    def run(self) -> SimulationResult:
        if not self._configured:
            raise RuntimeError("Call configure() before run()")
        ok = self._ninja.simulate_wind()
        if not ok:
            raise RuntimeError("simulate_wind() returned False")
        n = self._ninja
        return SimulationResult(
            speed=n.get_outputSpeedGrid().copy(),
            direction=n.get_outputDirectionGrid().copy(),
            projection=n.get_outputGridProjection(),
            cell_size=n.get_outputGridCellSize(),
            xllcorner=n.get_outputGridxllCorner(),
            yllcorner=n.get_outputGridyllCorner(),
            ncols=n.get_outputGridnCols(),
            nrows=n.get_outputGridnRows(),
            vel_filename=n.get_VelFileName(),
            ang_filename=n.get_AngFileName(),
        )

    def simulate(self, config: SimulationConfig) -> SimulationResult:
        self.configure(config)
        return self.run()


class TimeSeriesSession:
    """Multi-run time series simulation using sequential Ninja calls."""

    def __init__(self):
        self._core = _load_core()
        self._configs: list[SimulationConfig] = []

    def configure(self, dem_path: str, speeds: list[float],
                  directions: list[float], vegetation: str = "grass",
                  number_cpus: int = 2, mesh_resolution: float = 100.0,
                  input_wind_height: float = 10.0,
                  output_wind_height: float = 10.0,
                  diurnal_winds: bool = False,
                  non_neutral_stability: bool = False,
                  air_temp: float = None, cloud_cover: float = None,
                  year: int = None, month: int = None,
                  day: int = None, hour: int = None,
                  time_zone: Optional[str] = "UTC"):
        if len(directions) != len(speeds):
            raise ValueError("speeds and directions must have same length")
        self._configs = [
            SimulationConfig(
                dem_path=dem_path,
                input_speed=speeds[i],
                input_direction=directions[i],
                vegetation=vegetation,
                number_cpus=number_cpus,
                mesh_resolution=mesh_resolution,
                input_wind_height=input_wind_height,
                output_wind_height=output_wind_height,
                diurnal_winds=diurnal_winds,
                non_neutral_stability=non_neutral_stability,
                air_temp=air_temp,
                cloud_cover=cloud_cover,
                year=year,
                month=month,
                day=day,
                hour=hour,
                time_zone=time_zone,
            )
            for i in range(len(speeds))
        ]

    def run_all(self) -> list[SimulationResult]:
        if not self._configs:
            raise RuntimeError("Call configure() before run_all()")
        session = NinjaSession()
        return [session.simulate(cfg) for cfg in self._configs]
