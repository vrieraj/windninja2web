import hashlib
import logging
import math
from pathlib import Path

logger = logging.getLogger(__name__)

DATA_DIR = Path(__file__).resolve().parent.parent.parent.parent / "data"
DEM_CACHE_DIR = DATA_DIR / "dems"
ALOS_TILES_DIR = DATA_DIR / "alos"

class DEMCache:
    def __init__(self):
        DEM_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        ALOS_TILES_DIR.mkdir(parents=True, exist_ok=True)

    def _bbox_hash(self, north, south, east, west, dem_type="srtm"):
        key = f"{dem_type}_{north:.4f}_{south:.4f}_{east:.4f}_{west:.4f}"
        return hashlib.md5(key.encode()).hexdigest()

    def get_cached_path(self, north, south, east, west, dem_type="srtm"):
        h = self._bbox_hash(north, south, east, west, dem_type)
        candidates = list(DEM_CACHE_DIR.glob(f"{h}.*"))
        return candidates[0] if candidates else None

    def store_path(self, north, south, east, west, dem_type="srtm", ext=".tif") -> Path:
        h = self._bbox_hash(north, south, east, west, dem_type)
        path = DEM_CACHE_DIR / f"{h}{ext}"
        return path

    def list_available(self):
        files = []
        for f in sorted(DATA_DIR.iterdir()):
            if f.suffix.lower() in (".tif", ".tiff", ".asc", ".bil") and f.is_file():
                files.append({"name": f.name, "path": str(f.relative_to(DATA_DIR))})
        for f in sorted(DEM_CACHE_DIR.iterdir()):
            if f.suffix.lower() in (".tif", ".tiff", ".asc") and f.is_file():
                files.append({"name": f.name, "path": str(f.relative_to(DATA_DIR))})
        return files

dem_cache = DEMCache()

def resolve_dem(source: str, north: float = None, south: float = None,
                east: float = None, west: float = None,
                dem_type: str = "srtm") -> Path | None:
    if source == "auto":
        if None in (north, south, east, west):
            return None
        cached = dem_cache.get_cached_path(north, south, east, west, dem_type)
        if cached:
            logger.info("Using cached DEM: %s", cached)
            return cached
        return _fetch_dem(north, south, east, west, dem_type)
    path = Path(source)
    if not path.is_absolute():
        path = DATA_DIR / path
    if path.exists():
        return path
    return None

def _fetch_dem(north: float, south: float, east: float, west: float,
               dem_type: str = "srtm") -> Path | None:
    path = _fetch_opentopography(north, south, east, west, dem_type)
    if path is not None:
        return path
    if dem_type == "alos":
        logger.info("OpenTopography failed, trying JAXA tile download...")
        return _fetch_alos_tiles(north, south, east, west)
    return None

def _fetch_opentopography(north, south, east, west, dem_type):
    dem_map = {"srtm": "SRTM", "alos": "AW3D30", "cop30": "COP30"}
    dem_param = dem_map.get(dem_type, "SRTM")
    try:
        import requests
        api_key = ""
        url = (
            f"https://portal.opentopography.org/API/globaldem?dem={dem_param}&"
            f"south={south}&north={north}&west={west}&east={east}&"
            f"output=GTiff&api_key={api_key}"
        )
        logger.info("Fetching DEM from OpenTopography: %s", url[:120])
        resp = requests.get(url, timeout=180)
        resp.raise_for_status()
        out = dem_cache.store_path(north, south, east, west, dem_type, ".tif")
        with open(out, "wb") as f:
            f.write(resp.content)
        if _is_valid_geotiff(out):
            logger.info("Downloaded %s DEM to %s", dem_type, out)
            return out
        logger.warning("Downloaded file is not a valid GeoTIFF, removing")
        out.unlink()
        return None
    except Exception as e:
        logger.warning("OpenTopography download failed: %s", e)
        return None

def _is_valid_geotiff(path: Path) -> bool:
    try:
        from osgeo import gdal
        ds = gdal.Open(str(path))
        if ds is None:
            return False
        ok = ds.RasterXSize > 0 and ds.RasterYSize > 0
        ds = None
        return ok
    except Exception:
        return False

def _fetch_alos_tiles(north, south, east, west) -> Path | None:
    min_lat = int(math.floor(south))
    max_lat = int(math.ceil(north))
    min_lon = int(math.floor(west))
    max_lon = int(math.ceil(east))

    tile_paths = []
    for lat in range(min_lat, max_lat):
        for lon in range(min_lon, max_lon):
            tile = _download_alos_tile(lat, lon)
            if tile:
                tile_paths.append(tile)

    if not tile_paths:
        logger.warning("No ALOS tiles could be downloaded")
        return None

    if len(tile_paths) == 1:
        out = dem_cache.store_path(north, south, east, west, "alos", ".tif")
        if not _crop_to_bbox(tile_paths[0], out, north, south, east, west):
            return tile_paths[0]
        return out

    merged = _merge_tiles(tile_paths, north, south, east, west)
    return merged

def _download_alos_tile(lat: int, lon: int) -> Path | None:
    lat_str = f"N{abs(lat):03d}" if lat >= 0 else f"S{abs(lat):03d}"
    lon_str = f"E{abs(lon):03d}" if lon >= 0 else f"W{abs(lon):03d}"
    tile_name = f"{lat_str}{lon_str}"
    local_path = ALOS_TILES_DIR / f"{tile_name}.tif"

    if local_path.exists():
        logger.debug("Tile already cached: %s", local_path)
        return local_path

    urls = [
        f"https://www.eorc.jaxa.jp/ALOS/aw3d30/data/release_v2404/{lat_str}/{lon_str}/{tile_name}_DSM.tif",
        f"https://www.eorc.jaxa.jp/ALOS/aw3d30/data/release_v2304/{lat_str}/{lon_str}/{tile_name}_DSM.tif",
    ]
    for url in urls:
        try:
            import requests
            logger.info("Downloading ALOS tile: %s", url[:100])
            resp = requests.get(url, timeout=300)
            if resp.status_code != 200:
                continue
            with open(local_path, "wb") as f:
                f.write(resp.content)
            if _is_valid_geotiff(local_path):
                logger.info("ALOS tile downloaded: %s", local_path)
                return local_path
            local_path.unlink()
        except Exception as e:
            logger.debug("Failed to download tile %s: %s", tile_name, e)
    logger.warning("Could not download ALOS tile: %s", tile_name)
    return None

def _merge_tiles(tile_paths: list[Path], north, south, east, west) -> Path | None:
    out = dem_cache.store_path(north, south, east, west, "alos", ".tif")
    if out.exists():
        return out
    try:
        from osgeo import gdal, gdalconst
        vrt_path = out.with_suffix(".vrt")
        gdal.BuildVRT(str(vrt_path), [str(p) for p in tile_paths])
        gdal.Translate(str(out), str(vrt_path), format="GTiff",
                       projWin=[west, north, east, south],
                       outputSRS="EPSG:4326")
        vrt_path.unlink(missing_ok=True)
        if _is_valid_geotiff(out):
            logger.info("Merged %d ALOS tiles into %s", len(tile_paths), out)
            return out
        out.unlink(missing_ok=True)
        return None
    except Exception as e:
        logger.warning("Tile merge failed: %s", e)
        if tile_paths:
            return tile_paths[0]
        return None

def _crop_to_bbox(src: Path, dst: Path, north, south, east, west) -> bool:
    try:
        from osgeo import gdal
        gdal.Translate(str(dst), str(src), format="GTiff",
                       projWin=[west, north, east, south])
        return _is_valid_geotiff(dst)
    except Exception:
        return False
