import uuid
from enum import Enum

class TaskStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"

class TaskManager:
    def __init__(self):
        self._tasks = {}

    def create_task(self):
        task_id = str(uuid.uuid4())
        self._tasks[task_id] = {"status": TaskStatus.PENDING, "progress": 0.0}
        return task_id

    def get_status(self, task_id: str):
        return self._tasks.get(task_id)

task_manager = TaskManager()
