import hashlib
import logging
import math
import os
import time
from pathlib import Path
from io import BytesIO

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response
import requests

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["map"])

CACHE_DIR = Path(__file__).resolve().parent.parent.parent.parent / "data" / "map_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
CACHE_MAX_AGE = 86400

ESRI_URLS = {
    "satellite": "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export",
    "standard": "https://services.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/export",
    "hybrid": "https://services.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export",
}
LABELS_URL = "https://services.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/export"

MAX_RETRIES = 2
BACKOFF = 1.0

def _cache_key(north, south, east, west, layer, size):
    raw = f"{layer}_{size}_{north:.4f}_{south:.4f}_{east:.4f}_{west:.4f}"
    return hashlib.md5(raw.encode()).hexdigest() + ".png"

def _fetch_with_retry(url, params, timeout=12):
    for attempt in range(MAX_RETRIES):
        try:
            resp = requests.get(url, params=params, timeout=timeout)
            if resp.status_code == 200:
                return resp.content
            logger.warning("ESRI returned %d (attempt %d)", resp.status_code, attempt)
        except requests.RequestException as e:
            logger.warning("ESRI request failed (attempt %d): %s", attempt, e)
        if attempt < MAX_RETRIES - 1:
            time.sleep(BACKOFF * (attempt + 1))
    return None

@router.get("/map-image")
async def get_map_image(
    north: float, south: float, east: float, west: float,
    layer: str = "satellite", size: int = 1024,
):
    base = ESRI_URLS.get(layer)
    if not base:
        raise HTTPException(400, f"Unknown layer: {layer}")

    key = _cache_key(north, south, east, west, layer, size)
    cache_path = CACHE_DIR / key

    if cache_path.exists():
        age = time.time() - cache_path.stat().st_mtime
        if age < CACHE_MAX_AGE:
            logger.debug("Serving cached map image: %s", cache_path)
            return Response(
                content=cache_path.read_bytes(),
                media_type="image/png",
                headers={"Cache-Control": "public, max-age=86400"},
            )
        cache_path.unlink(missing_ok=True)

    params = {
        "bbox": f"{west},{south},{east},{north}",
        "bboxSR": "4326",
        "size": f"{size},{size}",
        "format": "png32",
        "transparent": "false",
        "f": "image",
    }

    content = _fetch_with_retry(base, params)
    if content is None:
        raise HTTPException(502, "Failed to fetch map image from ESRI")

    if layer == "hybrid":
        labels_content = _fetch_with_retry(LABELS_URL, params)
        if labels_content:
            try:
                from PIL import Image
                sat = Image.open(BytesIO(content)).convert("RGBA")
                lbl = Image.open(BytesIO(labels_content)).convert("RGBA")
                composite = Image.alpha_composite(sat, lbl)
                buf = BytesIO()
                composite.save(buf, format="PNG")
                content = buf.getvalue()
            except Exception as e:
                logger.warning("PIL composite failed: %s", e)

    cache_path.write_bytes(content)
    return Response(
        content=content,
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=86400"},
    )
