"""
Export simulation results to various geospatial formats using Python GDAL.
Replaces direct OutputWriter C++ bindings for full format control.
"""

import os
import zipfile
import numpy as np
from osgeo import gdal, osr, ogr

from app.core.ninja_bridge import SimulationResult


def _get_units_label(units: str = "mps") -> str:
    return {"mps": "m/s", "mph": "mph", "kph": "km/h", "kts": "knots"}.get(units, "m/s")


def export_geotiff(result: SimulationResult, output_path: str,
                   speed_units: str = "mps"):
    """Write speed + direction as a 2-band GeoTIFF."""
    drv = gdal.GetDriverByName("GTiff")
    ds = drv.Create(output_path, result.ncols, result.nrows, 2, gdal.GDT_Float32)
    gt = (result.xllcorner, result.cell_size, 0,
          result.yllcorner + result.nrows * result.cell_size, 0, -result.cell_size)
    ds.SetGeoTransform(gt)
    if result.projection:
        sr = osr.SpatialReference()
        sr.ImportFromWkt(result.projection)
        ds.SetProjection(sr.ExportToWkt())

    speed = np.flipud(result.speed).astype(np.float32)
    direction = np.flipud(result.direction).astype(np.float32)
    ds.GetRasterBand(1).WriteArray(speed)
    ds.GetRasterBand(1).SetDescription(f"Wind speed ({_get_units_label(speed_units)})")
    ds.GetRasterBand(2).WriteArray(direction)
    ds.GetRasterBand(2).SetDescription("Wind direction (degrees)")
    ds = None


def export_geopackage(results: list[SimulationResult], output_path: str,
                      speed_units: str = "mps"):
    """Write all simulation time steps as layers in a single GeoPackage."""
    if os.path.exists(output_path):
        os.unlink(output_path)
    drv = gdal.GetDriverByName("GPKG")
    ds = drv.Create(output_path, 0, 0, 0, gdal.GDT_Unknown)
    for idx, res in enumerate(results):
        layer_name = f"wind_{idx:04d}"
        layer = ds.CreateLayer(layer_name, geom_type=ogr.wkbPoint,
                               srs=_srs_from_wkt(res.projection))
        layer.CreateField(ogr.FieldDefn("speed", ogr.OFTReal))
        layer.CreateField(ogr.FieldDefn("direction", ogr.OFTReal))
        _write_vector_grid(layer, res, speed_units)
    ds = None


def export_kmz(results: list[SimulationResult], output_path: str,
               speed_units: str = "mps"):
    """Write all time steps as a single KMZ (KML in ZIP)."""
    import xml.etree.ElementTree as ET
    from zipfile import ZipFile, ZIP_DEFLATED

    ns = {"kml": "http://www.opengis.net/kml/2.2"}
    doc = ET.Element("{http://www.opengis.net/kml/2.2}Document")
    doc_name = ET.SubElement(doc, "name")
    doc_name.text = "WindNinja Simulation"

    for idx, res in enumerate(results):
        folder = ET.SubElement(doc, "Folder")
        fname = ET.SubElement(folder, "name")
        fname.text = f"Time step {idx:04d}"

        step = max(1, res.nrows // 40, res.ncols // 40)

        for r in range(0, res.nrows, step):
            for c in range(0, res.ncols, step):
                x = res.xllcorner + (c + 0.5) * res.cell_size
                y = res.yllcorner + (r + 0.5) * res.cell_size
                spd = res.speed[r, c]
                if spd <= 0:
                    continue
                pm = ET.SubElement(folder, "Placemark")
                desc = ET.SubElement(pm, "description")
                desc.text = (f"Speed: {spd:.1f} {_get_units_label(speed_units)}\n"
                             f"Direction: {res.direction[r, c]:.0f}°")
                pt = ET.SubElement(pm, "Point")
                coord = ET.SubElement(pt, "coordinates")
                coord.text = f"{x},{y},0"

    kml = ET.tostring(doc, encoding="utf-8", xml_declaration=True)
    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".kml", delete=False) as tmp:
        tmp_kml = tmp.name
        tmp.write(kml)
    try:
        with ZipFile(output_path, "w", ZIP_DEFLATED) as z:
            z.write(tmp_kml, "doc.kml")
    finally:
        os.unlink(tmp_kml)


def export_ascii_zip(results: list[SimulationResult], output_path: str,
                     speed_units: str = "mps"):
    """Write all grids as ESRI ASCII + wrap in ZIP."""
    with zipfile.ZipFile(output_path, "w", zipfile.ZIP_DEFLATED) as z:
        for idx, res in enumerate(results):
            speed = np.flipud(res.speed)
            direction = np.flipud(res.direction)
            for name, arr in [("speed", speed), ("direction", direction)]:
                lines = [
                    f"ncols         {res.ncols}",
                    f"nrows         {res.nrows}",
                    f"xllcorner     {res.xllcorner:.6f}",
                    f"yllcorner     {res.yllcorner:.6f}",
                    f"cellsize      {res.cell_size}",
                    "NODATA_value  -9999",
                ]
                for row in arr:
                    lines.append(" ".join(f"{v:.4f}" if v > -9998 else "-9999"
                                           for v in row))
                content = "\n".join(lines)
                z.writestr(f"{name}_{idx:04d}.asc", content)


def export_pdf(result: SimulationResult, output_path: str,
               speed_units: str = "mps"):
    """Write a PDF map with speed colormap and direction arrows."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    speed = np.flipud(result.speed)
    u, v = _speed_dir_to_uv(result.speed, result.direction)
    extent = (result.xllcorner,
              result.xllcorner + result.ncols * result.cell_size,
              result.yllcorner,
              result.yllcorner + result.nrows * result.cell_size)

    fig, ax = plt.subplots(figsize=(10, 8))
    im = ax.imshow(speed, cmap="viridis", aspect="auto", extent=extent)
    plt.colorbar(im, ax=ax, label=f"Wind speed ({_get_units_label(speed_units)})")

    step = max(1, result.nrows // 20, result.ncols // 20)
    x = np.arange(result.xllcorner + 0.5 * result.cell_size,
                  result.xllcorner + result.ncols * result.cell_size,
                  step * result.cell_size)
    y_arr = np.arange(result.yllcorner + 0.5 * result.cell_size,
                      result.yllcorner + result.nrows * result.cell_size,
                      step * result.cell_size)
    X, Y = np.meshgrid(x, y_arr)
    U = u[::step, ::step]
    V = v[::step, ::step]
    ax.quiver(X, Y, U, V, color="white", alpha=0.7, width=0.003)

    ax.set_title("WindNinja Simulation")
    ax.set_xlabel("Easting (m)")
    ax.set_ylabel("Northing (m)")
    fig.savefig(output_path, dpi=150, bbox_inches="tight")
    plt.close(fig)


def export_vtk(result: SimulationResult, output_path: str):
    """Write a simple VTK structured points file.
    Data stored row 0 = south (bottom-to-top), ORIGIN at yllCorner.
    """
    speed = result.speed
    direction = result.direction

    with open(output_path, "w") as f:
        f.write("# vtk DataFile Version 3.0\n")
        f.write("WindNinja output\n")
        f.write("ASCII\n")
        f.write("DATASET STRUCTURED_POINTS\n")
        f.write(f"DIMENSIONS {result.ncols} {result.nrows} 1\n")
        f.write(f"ORIGIN {result.xllcorner} {result.yllcorner} 0\n")
        f.write(f"SPACING {result.cell_size} {result.cell_size} 1\n")
        u, v_comp = _speed_dir_to_uv(speed, direction)
        f.write(f"POINT_DATA {result.ncols * result.nrows}\n")
        f.write("SCALARS wind_speed float 1\n")
        f.write("LOOKUP_TABLE default\n")
        for row in speed:
            f.write(" ".join(f"{v:.4f}" for v in row) + "\n")
        f.write("SCALARS wind_direction float 1\n")
        f.write("LOOKUP_TABLE default\n")
        for row in direction:
            f.write(" ".join(f"{v:.4f}" for v in row) + "\n")
        f.write("VECTORS wind_vector float\n")
        for i in range(result.nrows):
            for j in range(result.ncols):
                f.write(f"{u[i,j]:.4f} {v_comp[i,j]:.4f} 0.0\n")


# ── Internal helpers ──────────────────────────

def _srs_from_wkt(wkt: str) -> osr.SpatialReference:
    sr = osr.SpatialReference()
    if wkt:
        sr.ImportFromWkt(wkt)
    return sr


def _speed_dir_to_uv(speed: np.ndarray, direction: np.ndarray):
    """Convert meteorological speed/direction to u,v vector components."""
    rad = np.radians(direction)
    u = -speed * np.sin(rad)
    v = -speed * np.cos(rad)
    return u, v


def _write_vector_grid(layer: ogr.Layer, res: SimulationResult, units: str):
    """Sample grid at regular intervals and write point features.
    Grid data stored row 0 = south (bottom-to-top), matching yllCorner.
    """
    step = max(1, res.nrows // 40, res.ncols // 40)
    for r in range(0, res.nrows, step):
        for c in range(0, res.ncols, step):
            x = res.xllcorner + (c + 0.5) * res.cell_size
            y = res.yllcorner + (r + 0.5) * res.cell_size
            feat = ogr.Feature(layer.GetLayerDefn())
            feat.SetField("speed", float(res.speed[r, c]))
            feat.SetField("direction", float(res.direction[r, c]))
            feat.SetGeometry(ogr.CreateGeometryFromWkt(f"POINT ({x} {y})"))
            layer.CreateFeature(feat)
