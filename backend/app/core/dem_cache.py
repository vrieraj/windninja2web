import os
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
            return _reproject_to_utm(cached)
        path = _fetch_dem(north, south, east, west, dem_type)
        if path is None:
            return None
        return _reproject_to_utm(path)
    path = Path(source)
    if not path.is_absolute():
        path = DATA_DIR / path
    if path.exists():
        return _reproject_to_utm(path)
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
    dem_map = {"srtm": "SRTMGL1", "alos": "AW3D30", "cop30": "COP30"}
    dem_param = dem_map.get(dem_type, "SRTM")
    api_key = os.environ.get("OPENTOPOGRAPHY_API_KEY", "")
    if not api_key:
        logger.warning("OPENTOPOGRAPHY_API_KEY not set; try AWS terrain tiles fallback")
        return None
    try:
        import requests
        url = (
            f"https://portal.opentopography.org/API/globaldem?demtype={dem_param}&"
            f"south={south}&north={north}&west={west}&east={east}&"
            f"outputFormat=GTiff&API_Key={api_key}"
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

def _reproject_to_utm(dem_path: Path) -> Path:
    if dem_path.stem.endswith("_utm"):
        logger.debug("DEM already in UTM: %s", dem_path)
        return dem_path

    from osgeo import gdal, osr

    ds = gdal.Open(str(dem_path))
    if ds is None:
        logger.warning("Cannot open %s for UTM reprojection", dem_path)
        return dem_path

    src_srs = osr.SpatialReference()
    projection_wkt = ds.GetProjection()
    if projection_wkt:
        src_srs.ImportFromWkt(projection_wkt)
    else:
        src_srs.ImportFromEPSG(4326)

    if src_srs.IsProjected():
        ds = None
        logger.debug("DEM already projected: %s", dem_path)
        return dem_path

    gt = ds.GetGeoTransform()
    ncols = ds.RasterXSize
    nrows = ds.RasterYSize

    centroid_lon = gt[0] + (ncols * gt[1]) / 2.0
    centroid_lat = gt[3] + (nrows * gt[5]) / 2.0

    if src_srs.IsGeographic():
        geog_name = src_srs.GetAttrValue("GEOGCS")
        if geog_name and "WGS 84" not in geog_name:
            t_srs = osr.SpatialReference()
            t_srs.ImportFromEPSG(4326)
            tx = osr.CoordinateTransformation(src_srs, t_srs)
            pt = tx.TransformPoint(centroid_lon, centroid_lat)
            centroid_lon, centroid_lat = pt[0], pt[1]

    utm_zone = int(math.floor((centroid_lon + 180) / 6)) + 1
    epsg_code = 32600 + utm_zone if centroid_lat >= 0 else 32700 + utm_zone

    utm_path = dem_path.with_name(dem_path.stem + "_utm.tif")

    if utm_path.exists():
        ds = None
        logger.info("Using cached UTM DEM: %s", utm_path)
        return utm_path

    logger.info("Reprojecting DEM to UTM zone %d (EPSG:%d)...", utm_zone, epsg_code)

    gdal.Warp(
        str(utm_path),
        ds,
        dstSRS=f"EPSG:{epsg_code}",
        resampleAlg="cubic",
        format="GTiff",
    )

    ds = None

    if _is_valid_geotiff(utm_path):
        logger.info("UTM reprojected DEM saved to %s", utm_path)
        return utm_path

    logger.warning("UTM reprojection failed, returning original DEM")
    return dem_path


def _crop_to_bbox(src: Path, dst: Path, north, south, east, west) -> bool:
    try:
        from osgeo import gdal
        gdal.Translate(str(dst), str(src), format="GTiff",
                       projWin=[west, north, east, south])
        return _is_valid_geotiff(dst)
    except Exception:
        return False


def generate_preview_png(north: float, south: float, east: float, west: float,
                         dem_type: str = "srtm", max_dim: int = 1024) -> Path | None:
    """Generate a color-relief PNG from the cached WGS84 DEM for the given bbox."""
    cached = dem_cache.get_cached_path(north, south, east, west, dem_type)
    if cached is None:
        return None

    preview_path = cached.with_name(cached.stem + "_preview.png")
    if preview_path.exists():
        return preview_path

    from osgeo import gdal
    import uuid as uuid_mod

    tmp_tif = DEM_CACHE_DIR / f"_cropped_{uuid_mod.uuid4().hex[:8]}.tif"
    try:
        if not _crop_to_bbox(cached, tmp_tif, north, south, east, west):
            return None

        # Downsample if too large
        ds = gdal.Open(str(tmp_tif))
        if ds is None:
            return None
        w, h = ds.RasterXSize, ds.RasterYSize
        ds = None

        scale = min(1.0, max_dim / w, max_dim / h)
        if scale < 1.0:
            resized = DEM_CACHE_DIR / f"_resized_{uuid_mod.uuid4().hex[:8]}.tif"
            gdal.Warp(str(resized), str(tmp_tif),
                      width=int(w * scale), height=int(h * scale),
                      resampleAlg="bilinear", format="GTiff")
            tmp_tif.unlink(missing_ok=True)
            tmp_tif = resized

        # Write a color-ramp file
        ramp_lines = [
            "-500  68   1  84",
            "   0  59  82 139",
            " 200  33 145 140",
            " 500  94 201  98",
            "1000 197 231  87",
            "1500 253 231  37",
            "2000 245 130  28",
            "3000 252  78  42",
            "4000 180  40  30",
            "6000 255 255 255",
            "   nv   0   0   0",
        ]
        ramp_path = DEM_CACHE_DIR / f"_ramp_{uuid_mod.uuid4().hex[:8]}.txt"
        ramp_path.write_text("\n".join(ramp_lines))

        gdal.DEMProcessing(str(preview_path), str(tmp_tif),
                           "color-relief", colorFilename=str(ramp_path),
                           format="PNG")

        ramp_path.unlink(missing_ok=True)
        tmp_tif.unlink(missing_ok=True)

        if preview_path.exists() and preview_path.stat().st_size > 200:
            return preview_path
        return None
    except Exception as exc:
        logger.warning("generate_preview_png failed: %s", exc)
        try:
            tmp_tif.unlink(missing_ok=True)
        except Exception:
            pass
        return None
