"""
Bridge between Python and the C++ WindNinja core via pybind11.
Provides high-level Simulation and TimeSeries wrappers.
"""

import os
import logging
import numpy as np
from dataclasses import dataclass
from typing import Optional

logger = logging.getLogger(__name__)

_core = None

def _load_core():
    global _core
    if _core is not None:
        return _core
    try:
        import windninja_core
        _core = windninja_core
        return _core
    except ImportError as e:
        raise RuntimeError(
            "windninja_core module not found. "
            "Set PYTHONPATH to the directory containing windninja_core.so"
        ) from e


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
            if config.air_temp is not None:
                n.set_uniAirTemp(config.air_temp, self._core.TempUnits.C)
            if config.cloud_cover is not None:
                n.set_uniCloudCover(config.cloud_cover, self._core.CoverUnits.percent)
            if config.year is not None:
                n.set_date_time(
                    config.year, config.month, config.day,
                    config.hour, config.minute, config.second,
                    config.time_zone)

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
    """Multi-run time series simulation using ninjaArmy."""

    def __init__(self):
        self._core = _load_core()
        self._army = self._core.NinjaArmy()
        self._n_runs = 0

    def configure(self, dem_path: str, speeds: list[float],
                  directions: list[float], vegetation: str = "grass",
                  number_cpus: int = 2, mesh_resolution: float = 100.0,
                  input_wind_height: float = 10.0,
                  output_wind_height: float = 10.0):
        n_runs = len(speeds)
        if len(directions) != n_runs:
            raise ValueError("speeds and directions must have same length")
        self._n_runs = n_runs

        self._army.makeDomainAverageArmy(n_runs)
        for i in range(n_runs):
            self._army.setDEM(i, dem_path)
            self._army.setInputSpeed(i, speeds[i], "mps")
            self._army.setInputDirection(i, directions[i])
            self._army.setUniVegetation(i, vegetation)
            self._army.setNumberCPUs(i, number_cpus)
            self._army.setMeshResolution(i, mesh_resolution, "meters")
            self._army.setInputWindHeight(i, input_wind_height, "meters")
            self._army.setOutputWindHeight(i, output_wind_height, "meters")
            self._army.setPosition(i)
            self._army.setInitializationMethod(i, "domainAverage")
        self._army.setNumberCPUs(0, number_cpus)
        self._army.setPosition(0)

    def run_all(self) -> list[SimulationResult]:
        if self._n_runs == 0:
            raise RuntimeError("Call configure() before run_all()")
        ok = self._army.startRuns(2)
        if not ok:
            raise RuntimeError("startRuns() returned False")
        results = []
        for i in range(self._n_runs):
            row = self._army.getOutputGridnRows(i)
            col = self._army.getOutputGridnCols(i)
            results.append(SimulationResult(
                speed=self._army.getOutputSpeedGrid(i).copy(),
                direction=self._army.getOutputDirectionGrid(i).copy(),
                projection=self._army.getOutputGridProjection(i),
                cell_size=self._army.getOutputGridCellSize(i),
                xllcorner=self._army.getOutputGridxllCorner(i),
                yllcorner=self._army.getOutputGridyllCorner(i),
                ncols=col, nrows=row,
                vel_filename="", ang_filename="",
            ))
        return results
