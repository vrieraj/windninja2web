import uuid
import logging
from enum import Enum
from concurrent.futures import ThreadPoolExecutor
from typing import Optional
from backend.app.core.ninja_bridge import NinjaSession, TimeSeriesSession, SimulationConfig, SimulationResult
from backend.app.core.export import export_geotiff, export_geopackage, export_kmz, export_ascii_zip, export_pdf, export_vtk

logger = logging.getLogger(__name__)

class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"

class TaskManager:
    def __init__(self, max_workers: int = 2):
        self._tasks: dict[str, dict] = {}
        self._executor = ThreadPoolExecutor(max_workers=max_workers)

    def create_task(self) -> str:
        task_id = str(uuid.uuid4())
        self._tasks[task_id] = {
            "status": TaskStatus.PENDING,
            "progress": 0.0,
            "result": None,
            "error": None,
        }
        return task_id

    def update(self, task_id: str, status: TaskStatus, progress: float = None, result: SimulationResult = None, error: str = None):
        t = self._tasks.get(task_id)
        if t is None:
            return
        if status is not None:
            t["status"] = status
        if progress is not None:
            t["progress"] = progress
        if result is not None:
            t["result"] = result
        if error is not None:
            t["error"] = error

    def run_simulation(self, task_id: str, config: SimulationConfig):
        def _run():
            try:
                self.update(task_id, TaskStatus.RUNNING, 0.1)
                session = NinjaSession()
                session.configure(config)
                self.update(task_id, TaskStatus.RUNNING, 0.5)
                result = session.run()
                self.update(task_id, TaskStatus.COMPLETED, 1.0, result=result)
            except Exception as e:
                logger.exception("Simulation failed")
                self.update(task_id, TaskStatus.FAILED, error=str(e))
        self._executor.submit(_run)

    def run_timeseries(self, task_id: str, dem_path: str, speeds: list[float],
                       directions: list[float], vegetation: str = "grass",
                       number_cpus: int = 2):
        def _run():
            try:
                self.update(task_id, TaskStatus.RUNNING, 0.1)
                session = TimeSeriesSession()
                session.configure(dem_path, speeds, directions, vegetation, number_cpus)
                self.update(task_id, TaskStatus.RUNNING, 0.5)
                results = session.run_all()
                self.update(task_id, TaskStatus.COMPLETED, 1.0, result=results)
            except Exception as e:
                logger.exception("Time series failed")
                self.update(task_id, TaskStatus.FAILED, error=str(e))
        self._executor.submit(_run)

    def get_status(self, task_id: str) -> Optional[dict]:
        return self._tasks.get(task_id)

    def get_result(self, task_id: str) -> Optional[SimulationResult]:
        t = self._tasks.get(task_id)
        if t is None or t["status"] != TaskStatus.COMPLETED:
            return None
        return t["result"]

    def export(self, task_id: str, fmt: str, output_path: str):
        t = self._tasks.get(task_id)
        if t is None or t["status"] != TaskStatus.COMPLETED:
            raise ValueError(f"Task {task_id} not completed")
        result = t["result"]
        if fmt == "geotiff":
            if isinstance(result, list):
                for i, r in enumerate(result):
                    export_geotiff(r, output_path.replace(f".{fmt}", f"_{i:04d}.tif"))
            else:
                export_geotiff(result, output_path)
        elif fmt == "gpkg":
            results = result if isinstance(result, list) else [result]
            export_geopackage(results, output_path)
        elif fmt == "kmz":
            results = result if isinstance(result, list) else [result]
            export_kmz(results, output_path)
        elif fmt == "ascii-zip":
            results = result if isinstance(result, list) else [result]
            export_ascii_zip(results, output_path)
        elif fmt == "pdf":
            if isinstance(result, list):
                for i, r in enumerate(result):
                    export_pdf(r, output_path.replace(f".{fmt}", f"_{i:04d}.pdf"))
            else:
                export_pdf(result, output_path)
        elif fmt == "vtk":
            if isinstance(result, list):
                for i, r in enumerate(result):
                    export_vtk(r, output_path.replace(f".{fmt}", f"_{i:04d}.vtk"))
            else:
                export_vtk(result, output_path)
        else:
            raise ValueError(f"Unknown format: {fmt}")

task_manager = TaskManager()
