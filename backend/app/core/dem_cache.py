import hashlib
from pathlib import Path

DEM_CACHE_DIR = Path(__file__).resolve().parent.parent.parent.parent / "data" / "dems"

class DEMCache:
    def __init__(self):
        DEM_CACHE_DIR.mkdir(parents=True, exist_ok=True)

    def _bbox_hash(self, north, south, east, west):
        key = f"{north:.4f}_{south:.4f}_{east:.4f}_{west:.4f}"
        return hashlib.md5(key.encode()).hexdigest()

    def get_cached_path(self, north, south, east, west):
        h = self._bbox_hash(north, south, east, west)
        candidates = list(DEM_CACHE_DIR.glob(f"{h}.*"))
        return candidates[0] if candidates else None

    def store(self, north, south, east, west, ext: str) -> Path:
        h = self._bbox_hash(north, south, east, west)
        path = DEM_CACHE_DIR / f"{h}{ext}"
        return path

dem_cache = DEMCache()
