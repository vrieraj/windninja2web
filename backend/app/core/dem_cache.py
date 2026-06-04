import hashlib
import logging
from pathlib import Path

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent.parent.parent / "data"
DEM_CACHE_DIR = DATA_DIR / "dems"

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

    def store_path(self, north, south, east, west, ext: str) -> Path:
        h = self._bbox_hash(north, south, east, west)
        path = DEM_CACHE_DIR / f"{h}{ext}"
        return path

    def list_available(self):
        files = []
        for f in sorted(DATA_DIR.iterdir()):
            if f.suffix.lower() in (".tif", ".tiff", ".asc", ".bil"):
                files.append({"name": f.name, "path": str(f.relative_to(DATA_DIR))})
        for f in sorted(DEM_CACHE_DIR.iterdir()):
            if f.suffix.lower() in (".tif", ".tiff", ".asc"):
                files.append({"name": f.name, "path": str(f.relative_to(DATA_DIR))})
        return files

dem_cache = DEMCache()

def resolve_dem(source: str, north: float = None, south: float = None,
                east: float = None, west: float = None) -> Path | None:
    if source == "auto":
        if None in (north, south, east, west):
            return None
        cached = dem_cache.get_cached_path(north, south, east, west)
        if cached:
            return cached
        return _fetch_dem(north, south, east, west)
    path = Path(source)
    if not path.is_absolute():
        path = DATA_DIR / path
    if path.exists():
        return path
    return None

def _fetch_dem(north: float, south: float, east: float, west: float) -> Path | None:
    try:
        import requests
        api_key = ""  # OpenTopography public API (no key required for small requests)
        url = (
            f"https://portal.opentopography.org/API/globaldem?dem=SRTM&"
            f"south={south}&north={north}&west={west}&east={east}&"
            f"output=GTiff&api_key={api_key}"
        )
        resp = requests.get(url, timeout=120)
        resp.raise_for_status()
        out = dem_cache.store_path(north, south, east, west, ".tif")
        with open(out, "wb") as f:
            f.write(resp.content)
        logger.info("Downloaded DEM to %s", out)
        return out
    except Exception as e:
        logger.warning("DEM download failed: %s", e)
        return None
