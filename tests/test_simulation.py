"""
WindNinja Web — Integration tests for C++ core bindings.

Prerequisites:
  - windninja_core.so built and in PYTHONPATH
  - GDAL Python bindings available
  - data/missoula_valley.tif exists

Run: python -m pytest tests/ -v
"""

import os
import sys
import tempfile
import pytest
import numpy as np
from pathlib import Path

# Ensure backend is importable
REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO / "backend"))
sys.path.insert(0, str(REPO / "backend" / "lib"))

DATA = REPO / "data"
DEM = DATA / "missoula_valley.tif"


# ── Fixtures ──────────────────────────────────

def _has_core():
    try:
        import windninja_core
        return True
    except ImportError:
        return False


# ── DEM validation ────────────────────────────

def test_dem_exists():
    assert DEM.exists(), f"Sample DEM not found: {DEM}"


def test_dem_readable():
    from osgeo import gdal
    ds = gdal.Open(str(DEM))
    assert ds is not None, f"Cannot open {DEM}"
    assert ds.RasterXSize > 0
    assert ds.RasterYSize > 0
    ds = None


# ── Core module loading ───────────────────────

def test_core_import():
    if not _has_core():
        pytest.skip("windninja_core not built yet")
    import windninja_core
    assert hasattr(windninja_core, "Ninja")
    assert hasattr(windninja_core, "NinjaArmy")


# ── Single simulation ─────────────────────────

def test_single_simulation():
    if not _has_core():
        pytest.skip("windninja_core not built yet")
    from app.core.ninja_bridge import NinjaSession, SimulationConfig

    config = SimulationConfig(
        dem_path=str(DEM),
        input_speed=5.0,
        input_direction=270.0,
        mesh_resolution=100.0,
        number_cpus=2,
    )
    session = NinjaSession()
    result = session.simulate(config)

    assert result.speed.shape == (result.nrows, result.ncols)
    assert result.direction.shape == (result.nrows, result.ncols)
    assert result.nrows > 0
    assert result.ncols > 0
    assert result.cell_size > 0
    assert np.all(result.speed >= 0), "Negative wind speeds"
    assert np.all((result.direction >= 0) & (result.direction <= 360)), \
        "Directions out of range"


# ── Time series ───────────────────────────────

def test_timeseries():
    if not _has_core():
        pytest.skip("windninja_core not built yet")
    from app.core.ninja_bridge import TimeSeriesSession

    n = 3
    speeds = [3.0, 5.0, 8.0]
    directions = [270.0, 270.0, 270.0]

    session = TimeSeriesSession()
    session.configure(str(DEM), speeds, directions, number_cpus=2)
    results = session.run_all()

    assert len(results) == n
    for i, res in enumerate(results):
        assert res.nrows > 0
        assert res.ncols > 0
        assert np.mean(res.speed) > 0


# ── Export formats ────────────────────────────

def _mock_result():
    from app.core.ninja_bridge import SimulationResult
    rng = np.random.default_rng(42)
    return SimulationResult(
        speed=rng.random((50, 60)).astype(np.float64) * 10,
        direction=rng.random((50, 60)).astype(np.float64) * 360,
        projection="",
        cell_size=100.0,
        xllcorner=0.0, yllcorner=0.0,
        ncols=60, nrows=50,
        vel_filename="", ang_filename="",
    )


def test_export_geotiff():
    from app.core.export import export_geotiff
    from osgeo import gdal
    res = _mock_result()
    with tempfile.NamedTemporaryFile(suffix=".tif", delete=False) as f:
        try:
            export_geotiff(res, f.name)
            ds = gdal.Open(f.name)
            assert ds is not None
            assert ds.RasterCount == 2
            assert ds.RasterXSize == 60
            assert ds.RasterYSize == 50
            ds = None
        finally:
            os.unlink(f.name)


def test_export_geopackage():
    from app.core.export import export_geopackage
    from osgeo import ogr
    results = [_mock_result() for _ in range(3)]
    with tempfile.NamedTemporaryFile(suffix=".gpkg", delete=False) as f:
        path = f.name
    try:
        os.unlink(path)  # GPKG driver requires file to NOT exist
        export_geopackage(results, path)
        ds = ogr.Open(path)
        assert ds is not None
        assert ds.GetLayerCount() == 3
        ds = None
    finally:
        if os.path.exists(path):
            os.unlink(path)


def test_export_kmz():
    from app.core.export import export_kmz
    from zipfile import ZipFile
    results = [_mock_result() for _ in range(2)]
    with tempfile.NamedTemporaryFile(suffix=".kmz", delete=False) as f:
        try:
            export_kmz(results, f.name)
            with ZipFile(f.name) as z:
                assert "doc.kml" in z.namelist()
        finally:
            os.unlink(f.name)


def test_export_ascii_zip():
    from app.core.export import export_ascii_zip
    from zipfile import ZipFile
    results = [_mock_result() for _ in range(2)]
    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as f:
        try:
            export_ascii_zip(results, f.name)
            with ZipFile(f.name) as z:
                names = z.namelist()
                assert any("speed" in n for n in names)
        finally:
            os.unlink(f.name)


def test_export_pdf():
    from app.core.export import export_pdf
    res = _mock_result()
    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        try:
            export_pdf(res, f.name)
            assert os.path.getsize(f.name) > 1000
        finally:
            os.unlink(f.name)


def test_export_vtk():
    from app.core.export import export_vtk
    res = _mock_result()
    with tempfile.NamedTemporaryFile(suffix=".vtk", delete=False) as f:
        try:
            export_vtk(res, f.name)
            with open(f.name) as fh:
                content = fh.read()
            assert "DATASET STRUCTURED_POINTS" in content
            assert "wind_speed" in content
        finally:
            os.unlink(f.name)



