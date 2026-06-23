import sys
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent

# Prefer package install (pip install -e ./backend); fallback to sys.path
try:
    import app  # noqa: F401
except ImportError:
    sys.path.insert(0, str(REPO / "backend"))
    sys.path.insert(0, str(REPO / "backend" / "lib" / "build"))
