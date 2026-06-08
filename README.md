# WindNinja Web

> *Web fork of [WindNinja](https://github.com/firelab/windninja), the diagnostic wind model from the RMRS Missoula Fire Sciences Lab (US Forest Service).*

WindNinja is a diagnostic wind model originally developed by the **Missoula Firelab** for wildland fire modeling. It computes high-resolution winds over complex terrain using input meteorological data and a digital elevation model (DEM).

This fork migrates the simulation engine to a **web environment** accessible from the browser, with 3D terrain visualization and wind animation.

**Original website:** https://ninjastorm.firelab.org/windninja/  
**Original repository:** https://github.com/firelab/windninja

---

## Features

- **Wind simulation** — Run WindNinja directly from the browser, both single simulations and multi-hour time series.
- **Elevation models** — Automatic DEM download from **SRTM (30m)**, **ALOS AW3D30**, and **COP30** via the OpenTopography API.
- **Weather models** — 3 integrated Open-Meteo models:
  - **IFS** (ECMWF, 25km, forecast)
  - **GFS** (NOAA, forecast)
  - **ERA5** (ECMWF, historical reanalysis)
- **3D viewer** — Three.js terrain with satellite/standard/hybrid textures, wind arrows color-coded by speed, animated compass, and vertical exaggeration slider.
- **Time animation** — Interactive slider to navigate multi-hour simulation steps.
- **Export** — 6 formats: GeoTIFF, GeoPackage, KMZ, ASCII (ZIP), PDF with map, VTK.
- **GeoJSON import** — Load custom polygons onto the 3D terrain.
- **REST API** — FastAPI backend with documented endpoints for simulation, DEM, export, and weather data.

---

## Stack

| Layer | Technology |
|-------|------------|
| Backend | Python 3.11+ / FastAPI / Uvicorn |
| Frontend | HTML + CSS + JavaScript (ES modules) |
| 3D viewer | Three.js |
| 2D map | Leaflet + Leaflet.Draw |
| DEM models | GDAL / OpenTopography API |
| Weather | Open-Meteo API |
| C++ compilation | CMake + pybind11 (for native core) |
| Containerization | Multi-stage Docker |

---

## Local usage

### Requirements

- **Python 3.11+**
- **GDAL** >= 3.13.0 (system-installed)
- **pip** package manager

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/vrieraj/windninja2web.git
cd windninja2web

# 2. Create and activate virtual environment
cd backend
python -m venv .venv
source .venv/bin/activate    # Linux/macOS
# .venv\Scripts\activate     # Windows

# 3. Install dependencies
pip install -r requirements.txt

# 4. Start the development server
python -m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000
```

Open **http://127.0.0.1:8000** in your browser.

### Workflow

1. Select an area on the map using the rectangle tool.
2. Choose a DEM source (SRTM, ALOS, COP30) and download it.
3. Configure weather parameters (manual or Open-Meteo).
4. Click **Simulate** and wait for completion.
5. Browse results with the time slider.
6. Export in the desired format.

---

## Project structure

```
windninja2web/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app
│   │   ├── routes/
│   │   │   ├── simulation.py    # /simulate endpoints
│   │   │   ├── dem.py           # /dem endpoints
│   │   │   ├── export.py        # /export endpoints
│   │   │   ├── map.py           # /api/map-image
│   │   │   └── meteo.py         # /api/meteo/fetch
│   │   ├── core/
│   │   │   ├── ninja_bridge.py  # pybind11 wrapper
│   │   │   ├── task_manager.py  # async simulation tasks
│   │   │   ├── export.py        # format export
│   │   │   └── dem_cache.py     # DEM caching
│   │   └── models/
│   │       └── schemas.py       # Pydantic models
│   ├── lib/                     # C++ bindings (pybind11)
│   ├── requirements.txt
│   └── .venv/
├── frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/
│       ├── app.js               # entry point + event delegation
│       ├── state.js             # shared global state
│       ├── viewer.js            # 3D viewer (Three.js) + 2D map
│       ├── sidebar.js           # side panel
│       └── simulation.js        # API calls
├── src/                         # Original C++ WindNinja core
├── data/                        # test data
├── Dockerfile                   # multi-stage build
└── AGENTS.md                    # technical documentation
```

---

## Available weather models

| Model | Provider | Type | Resolution | Coverage |
|-------|----------|------|------------|----------|
| IFS | ECMWF | Forecast | 25 km | 7 days |
| GFS | NOAA | Forecast | 3–25 km | 16 days |
| ERA5 | ECMWF | Reanalysis | 11 km | 1950–present |

---

## Credits

WindNinja is software from the **RMRS Missoula Fire Sciences Lab**, USDA Forest Service.

Code generated via **vibecoding** with **[opencode](https://opencode.ai)** + **Big Pickle** (model opencode/big-pickle).

---

## License

See [LICENSE](./LICENSE) and [LICENSE-3RD-PARTY](./LICENSE-3RD-PARTY).
