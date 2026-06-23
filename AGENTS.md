# WindNinja Web — Plan de Migración

## 1. Resumen del Proyecto

WindNinja es un modelo de viento diagnóstico desarrollado por el RMRS Missoula Fire Sciences Lab (USFS). Es C++20 con GUI Qt6, 185+ archivos fuente en el core. Migramos su motor de simulación a un entorno web desplegado en Hugging Face Spaces.

---

## 2. Arquitectura Propuesta

```
┌─────────────────────────────────────────────────────────┐
│                   Hugging Face Space                     │
│                                                          │
│  ┌────────────────────────────────────────────────┐      │
│  │              FastAPI (Python)                    │      │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────────┐  │      │
│  │  │ /simulate│  │ /status  │  │ /export/{fmt} │  │      │
│  │  ├──────────┤  ├──────────┤  ├──────────────┤  │      │
│  │  │   C++    │  │  Redis/  │  │  GDAL conv   │  │      │
│  │  │  ninja   │  │  mem     │  │  (async)     │  │      │
│  │  │  library │  │  state   │  │              │  │      │
│  │  └────┬─────┘  └──────────┘  └──────────────┘  │      │
│  │       │ pybind11                                 │      │
│  │  ┌────▼─────────────────────────────────────────┐│      │
│  │  │  C++ WindNinja Core (ninja static lib)       ││      │
│  │  │  + GDAL + Boost + OpenMP                     ││      │
│  │  └──────────────────────────────────────────────┘│      │
│  └────────────────────────────────────────────────┘      │
│                                                          │
│  ┌────────────────────────────────────────────────┐      │
│  │           Frontend (HTML + JS)                  │      │
│  │  ┌──────────────┐ ┌──────────────────────────┐ │      │
│  │  │ Side Panel   │ │ 3D Viewer (Three.js)     │ │      │
│  │  │ (collapsible)│ │ - Selección de área      │ │      │
│  │  │ Meteo inputs │ │ - Visualización DEM      │ │      │
│  │  │ Export       │ │ - Flechas de viento 3D   │ │      │
│  │  │ Time slider  │ │ - Time evolution anim    │ │      │
│  │  └──────────────┘ └──────────────────────────┘ │      │
│  └────────────────────────────────────────────────┘      │
└─────────────────────────────────────────────────────────┘
```

---

## 3. Decisiones Técnicas

### 3.1 Integración C++ → Python

| Opción | Veredicto |
|--------|-----------|
| **pybind11** | ✅ **RECOMENDADO**. Bindings directos a `ninjaArmy` + `ninja`. Performance máximo, acceso completo a la API. |
| Subprocess CLI | ❌ Overhead de serialización, no podemos acceder a grids en memoria. |
| ctypes | Posible pero tedioso. pybind11 es más moderno. |

Flujo: compilar `src/ninja/` como shared library (`.so`/`.dll`), generar bindings con pybind11 que expongan:
- `set_DEM(dem_array, ncols, nrows, georef, prj)`
- `set_inputSpeed`, `set_inputDirection`, `set_vegetation`, etc.
- `simulate_wind()` → devuelve grids de velocidad/dirección como arrays numpy
- `ninjaArmy` para time series

### 3.2 Visor 3D

| Opción | Veredicto |
|--------|-----------|
| **Three.js** | ✅ **RECOMENDADO**. Ligero, flexible, flechas 3D nativas con `ConeGeometry`, animación temporal vía `requestAnimationFrame`. Terreno custom desde DEM + texturas satélite ESRI. Sin dependencia externa de API key. |

### 3.3 DEM — ALOS World 3D

ALOS World 3D (AW3D30) es un DEM global de 30m (~1 arcsec) gratuito. Alternativas:
- **SRTM** (~30m, ya soportado por WindNinja vía GDAL/SRTM fetch)
- **ALOS World 3D** (~30m, mejor cobertura, menos huecos)
- **COP30** (Copernicus 30m, muy bueno)

Estrategia:
1. Ofrecer **descarga automática** vía OpenTopography API o directamente desde JAXA (requiere registrarse).
2. También permitir **subida manual** del DEM (GeoTIFF, .asc).
3. Para Hugging Face, recomendar tiles precortados en un bucket o descarga bajo demanda con caché.

**ALOS AW3D30**: https://www.eorc.jaxa.jp/ALOS/en/aw3d30/ — disponible para descarga gratuita en tiles 1x1 grado.

### 3.4 Simulaciones por Tiempo (Evolución)

WindNinja soporta time series vía `ninjaArmy`:
- `makeDomainAverageArmy(nRuns, ...)` con listas de speed/direction.
- `makeWeatherModelArmy(forecastFile, timezone, timeList, ...)` para pronósticos multi-horario.
- `startRuns(nCPUs)` ejecuta en paralelo.

Esto nos permite generar N simulaciones y animarlas con un slider.

### 3.5 Backend

- **FastAPI** con WebSocket para progreso en tiempo real.
- Las simulaciones se lanzan como tareas asíncronas (BackgroundTasks o Celery).
- Resultados intermedios almacenados en disco/memoria, servidos como FlatGeoBuf + PNG para preview rápida.
- Exportación post-simulación: GeoTIFF, **GeoPackage** (multi-capa), **KMZ** (multi-capa), **ASCII** (ZIP), PDF, VTK.

### 3.6 Formato de Exportación — Reglas

| Formato | Estrategia |
|---------|------------|
| **GeoTIFF** | Un archivo .tif por simulación (raster multi-banda: velocidad + dirección) |
| **GeoPackage** | **Un solo archivo .gpkg** con todas las capas vectoriales de todas las simulaciones (capa por timestamp). Reemplaza a SHP. |
| **KMZ** | **Un solo archivo .kmz** con todas las simulaciones empaquetadas (folders por timestamp, estilos por velocidad). |
| **ASCII** | **ZIP** con todos los grids .asc de todas las simulaciones (velocidad, dirección, proj/geog/uv). |
| **PDF** | Un PDF por simulación (con mapa base topográfico y flechas de viento). |
| **VTK** | Un .vtk por simulación (volumen 3D). |
| **FlatGeoBuf** | Un .fgb por simulación (para previsualización rápida en el visor). |

---

## 4. Plan por Fases

### Fase 0 — Infraestructura ✅
- [x] Crear estructura de directorios del proyecto web
- [x] CMake standalone para shared library + pybind11 (backend/lib/CMakeLists.txt)
- [x] Bindings C++ skeleton (backend/lib/bindings.cpp)
- [x] Dockerfile multi-etapa (build C++ → deploy Python)
- [x] CI/CD para Hugging Face Spaces (deploy-hf.yml)
- [x] Frontend scaffold (sidebar colapsable, 3D viewer stub, simulation/export)
- [x] Backend Python stubs (FastAPI app, routes, core modules, Pydantic schemas)

### Fase 1 — Core Wrapper Python ✅
- [x] Bindings pybind11 para `ninja` + `ninjaArmy` (incluyendo setPosition, getOutputGridxllCorner, etc.)
- [x] 7 enums expuestos (InitMethod, Vegetation, VelocityUnits, LengthUnits, TempUnits, CoverUnits, MeshChoice)
- [x] Inputs: DEM, speed, dir, veg, windHeight, mesh, date/time, temp, cloudCover
- [x] `simulate_wind()` → grids numpy (speed, direction, projection, cellSize, xllCorner, yllCorner)
- [x] `NinjaSession` + `TimeSeriesSession` wrappers con configuración completa
- [x] `export.py` Python puro: GeoTIFF, GeoPackage, KMZ, ASCII-ZIP, PDF, VTK (6 formatos)
- [x] 11 tests (3 mock, 8 requieren windninja_core compilado)

### Fase 2 — API REST ✅
- [x] FastAPI endpoints: POST /simulate, GET /status, GET /result, GET /export, GET /dem/available, POST /dem/fetch
- [x] TaskManager asíncrono con ThreadPoolExecutor + threading.Lock
- [x] GET /simulate/grid/{task_id} devuelve GeoJSON sampleado con reproyección WGS84
- [x] Manejo de caché de DEMs por tipo + bbox
- [x] Time series: POST /simulate/timeseries

### Fase 3 — Frontend (3D Viewer) ✅
- [x] Integración Three.js con DEM 3D y texturas satélite ESRI
- [x] Herramienta de selección de área con ScreenSpaceEventHandler
- [x] Sidebar acordeón con 6 paneles colapsables (solo uno abierto)
- [x] Botón "Simular" + barra de progreso con polling cada 1.5s
- [x] Flechas 3D (conos) coloreadas por velocidad, orientadas por dirección
- [x] Slider temporal para animar time series
- [x] Botones de exportación por formato (6 formatos)

### Fase 4 — ALOS World 3D ✅
- [x] Descarga vía OpenTopography API (SRTM, AW3D30, COP30)
- [x] Fallback JAXA tile download para AW3D30
- [x] Mosaico automático con GDAL BuildVRT + Translate
- [x] Caché por tipo de DEM + bbox hash
- [x] Crop a bounding box con projWin
- [x] Integración con UI dropdown

### Fase 5 — Producción ✅
- [x] Ajustes HF Spaces: Dockerfile multietapa, .dockerignore, deploy-hf.yml
- [x] CORS middleware configurado
- [x] GDAL version flexible (`>=3.0.0` en requirements.txt, pin exacto via Dockerfile según distro base)
- [x] Temp file cleanup con BackgroundTasks
- [x] .env excluido del build (token va como Secret de HF)
- [x] Documentación completa en AGENTS.md (arquitectura, decisiones, auditorías)
- [x] Pre-deployment audit: 12 issues corregidos (4 blocker, 4 critical, 4 major)

---

## 10. Post-Fase: Auditoría

Cada fase incluye una auditoría post-entrega. Los hallazgos se registran aquí.

### Fase 0 — Hallazgos de Auditoría

**Críticos (corregidos):**
1. `frontend/js/viewer.js:13` — Herramienta de selección de área con `ScreenSpaceEventHandler` + dibujo manual de rectángulo.
2. `backend/lib/bindings.cpp` — No se exponían getters de grids de resultado. Añadidos `get_outputSpeedGrid`, `get_outputDirectionGrid`, `get_outputGridProjection`, etc. como wrappers numpy.
3. `backend/app/main.py:7,11` — Paths relativos rotos a `frontend/`. Corregido con `Path(__file__).resolve()`.

**Mayores (corregidos):**
4. `backend/lib/CMakeLists.txt:87,98` — Variable `OPENMP_FOUND` vs `OpenMP_FOUND` (case-sensitive). Corregido.
5. `backend/lib/CMakeLists.txt:78` — Falta fallback pkg-config para shapelib en Linux. Añadido.
6. `backend/lib/CMakeLists.txt:98-99` — `find_package(OpenMP REQUIRED)` redundante. Simplificado.
7. `backend/Dockerfile` — Stage 1 innecesario (no se enlaza contra libninja). Simplificado a 2 stages.
8. `.github/workflows/deploy-hf.yml:26-28` — Push a ghcr.io en vez de registry.huggingface.co. Corregido.
9. `backend/app/core/ninja_bridge.py:14-16` — `simulate()` era no-op. Pendiente para Fase 1.

**Menores (corregidos):**
10. `frontend/js/viewer.js:1` — Token de API vacío. Pendiente de añadir en HF Secrets si se requiere.
11. `backend/app/models/schemas.py:24-25` — Añadido `model_validator` para validar que `speeds` y `directions` tengan igual longitud.
12. `backend/app/models/schemas.py:31` — `fmt` ya usa `Literal`.

### Fase 1 — Hallazgos de Auditoría

**Críticos (corregidos):**
1. `backend/app/core/export.py:23-24,31-32` — GeoTIFF geotransform incorrecto. WindNinja almacena grids row 0 = sur (bottom-to-top). `np.flipud` invertía el orden pero el geotransform seguía referenciando `yllCorner` (borde sur) como origen en vez del borde norte. Corregido: `gt[3] = yllCorner + nrows * cellSize`, `gt[5] = -cellSize`.
2. `backend/app/core/export.py:71-78` — KMZ: mismo issue de flipud. Datos del norte colocados en coordenadas del sur. Corregido: sin flipud, coordenadas `y = yllCorner + (r + 0.5) * cellSize` con datos originales (row 0 = sur).
3. `backend/app/core/export.py:142-143` — VTK: flipud innecesario. Datos escritos bottom-to-top con ORIGEN en yllCorner (borde sur) → correcto. Removido flipud.
4. `tests/test_simulation.py:56,66,93` — `pytest` usado antes de ser importado (import en línea 198 al fondo). Movido a línea 4 (top del archivo).

**Mayores (corregidos):**
5. `backend/app/core/ninja_bridge.py:92,99` — `set_outputSpeedUnits` llamado dos veces (línea 92 con mps fijo, luego línea 99 con valor del config). Eliminada línea 92.
6. `backend/app/core/ninja_bridge.py:184` — `TimeSeriesSession.run_all()` usaba `xllcorner=0.0, yllcorner=0.0` hardcodeado. Corregido: bindea y usa `getOutputGridxllCorner(i)` y `getOutputGridyllCorner(i)`.
7. `backend/app/core/ninja_bridge.py:152-167` — `TimeSeriesSession.configure()` no llamaba `setPosition(i)`, `setMeshResolution(i)`, `setInputWindHeight(i)`, ni `setOutputWindHeight(i)`. Añadidos.
8. `tests/test_simulation.py:116-117` — `_mock_result` sin seed fijo → tests no reproducibles. Corregido: `np.random.default_rng(42)`.
9. `backend/lib/bindings.cpp:195-198` — Bindings de `getOutputGridProjection`, `getOutputGridCellSize`, `getOutputGridnCols`, `getOutputGridnRows` para `NinjaArmy` no aceptaban `nIndex`. Añadido lambda con parámetro nIndex.
10. `backend/lib/bindings.cpp:179` — `setOutputPath` expuesto dos veces para `NinjaArmy`. Eliminado duplicado.
11. `backend/lib/bindings.cpp:260` — Añadidos bindings faltantes de `NinjaArmy`: `setPosition`, `setOutputSpeedUnits`, `setInputWindHeight`, `setOutputWindHeight`, `setMeshResolution`, `setInitializationMethod`, `setDiurnalWinds`, `setUniAirTemp`, `setUniCloudCover`, `getOutputGridxllCorner`, `getOutputGridyllCorner`.

**Menores (corregidos):**
12. `backend/app/core/export.py:122-137` — PDF no mostraba coordenadas reales ni dirección. Añadido `extent` real y flechas `quiver`.
13. `backend/app/core/export.py:154-161` — VTK solo tenía `SCALARS`, añadido campo `VECTORS wind_vector` con componentes u/v.
14. `tests/test_simulation.py:138,151,162,174,183,194` — Archivos temporales envueltos en `try/finally` para garantizar cleanup aunque falle el test.

**Corregidos en Fase 2:**
15. `backend/lib/bindings.cpp:16-24` — `as_numpy` ahora recibe `py::object parent` (default `py::none()`). Los callers pasan `py::cast(self)` para que el array numpy retenga una referencia al objeto C++ dueño del buffer.
16. `backend/lib/bindings.cpp:261-269` — Bindings de `OutputWriter` eliminados. Eran vestigiales (export.py usa GDAL puro) y requerían `AsciiGrid<double>` no expuesto a Python.
17. `backend/app/models/schemas.py:31` — `fmt` ya usa `Literal`.

### Fase 5 — Hallazgos de Auditoría (Pre-Deploy)

**Blocker (corregidos):**
1. `frontend/index.html:5,11,23` — Static mount mismatch: `backend/app/main.py` monta `/static` pero HTML referenciaba URLs sin prefijo. Corregido: rutas `js/...` → `/static/js/...`.
2. `backend/app/routes/export.py` — Temp files sin cleanup. Archivos creados por `export_to_format()` nunca se eliminaban tras servir la respuesta. Corregido: `NamedTemporaryFile` + `BackgroundTasks.add_task(_cleanup)`.
3. `frontend/index.html` — Faltaba widgets.css. Corregido: añadido link a leaflet CSS.
4. `backend/app/core/ninja_bridge.py:10-12` — `from osgeo import gdal, osr` al nivel del módulo → falla si GDAL no está instalado en import. Corregido: imports diferidos dentro de `_run()` y `find_gdal_data()`.

**Critical (corregidos):**
5. `backend/app/routes/simulation.py:97-108` — DEM subido se ignoraba en el payload. El path del DEM subido no se pasaba al `SimulationRequest.user_dem_path`. Corregido: endpoint `POST /simulate` recibe `user_dem_path` y lo pasa a `ninja_bridge`.
6. `backend/app/core/ninja_bridge.py:152-167` — `TimeSeriesSession.configure()` no propagaba `mesh_resolution` a `setMeshResolution(i)`. Corregido.
7. `backend/app/core/ninja_bridge.py:77` — `startRuns(2)` hardcodeado. Corregido: usa `self._n_cpus`.
8. `backend/app/core/task_manager.py:42-45` — `_tasks` dict accedido sin lock desde `get_status()`. Corregido: `with self._lock:` en todos los accesos.

**Major (corregidos):**
9. `backend/app/routes/dem.py:33-38` — Upload DEM filename generado con `dem_cache.store_path()` que depende de bbox (0,0,0,0) → colisión de hash. Corregido: `uuid4()[:8]` + `DEM_CACHE_DIR`.
10. `backend/app/main.py` — Sin CORS middleware. Las peticiones desde el frontend JS al backend son cross-origin en HF Spaces. Corregido: `CORSMiddleware(allow_origins=["*"])`.
11. `backend/requirements.txt` — GDAL con pin rígido. Corregido: `gdal>=3.0.0` (compatible Ubuntu 22.04 y Arch).
12. `backend/app/core/ninja_bridge.py:200-210` — `TimeSeriesSession.configure()` no pasaba `air_temp`, `cloud_cover`, `datetime` aunque `diurnal_winds=True`. Corregido: parámetros extendidos.

---

## 5. Estructura de Directorios Propuesta

```
windninja-web/
├── backend/
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py              # FastAPI app
│   │   ├── routes/
│   │   │   ├── simulation.py    # /simulate endpoints
│   │   │   ├── dem.py           # /dem endpoints
│   │   │   └── export.py        # /export endpoints
│   │   ├── core/
│   │   │   ├── ninja_bridge.py  # pybind11 wrapper calls
│   │   │   ├── task_manager.py  # async simulation tasks
│   │   │   └── dem_cache.py     # DEM caching logic
│   │   └── models/
│   │       └── schemas.py       # Pydantic models
│   ├── lib/                     # compiled ninja shared lib
│   │   ├── bindings.cpp         # pybind11 bindings
│   │   ├── CMakeLists.txt       # builds shared lib
│   │   └── libwindninja.so/dll
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── index.html
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── app.js               # main app logic
│       ├── viewer.js            # 3D viewer (Three.js + Leaflet)
│       ├── sidebar.js           # collapsible panels
│       ├── simulation.js        # API calls
│       └── export.js            # export controls
├── data/
│   ├── dems/                    # cached DEM tiles
│   └── alos/                    # ALOS AW3D30 tiles
├── tests/
│   ├── conftest.py              # pytest config
│   └── test_simulation.py       # 11 tests (3 mock, 8 C++)
├── AGENTS.md
└── README.md
```

---

## 6. API C++ a Exponer (pybind11)

Prioridad alta (esencial para MVP):

| Método C++ | Binding |
|---|---|
| `ninja::set_DEM(string)` | ✅ |
| `ninja::set_DEM(double*, int, int, double*, string)` | ✅ desde numpy |
| `ninja::set_inputSpeed(double, units)` | ✅ |
| `ninja::set_inputDirection(double)` | ✅ |
| `ninja::set_uniVegetation(eVegetation)` | ✅ |
| `ninja::set_diurnalWinds(bool)` | ✅ |
| `ninja::set_date_time(int,y,m,d,h,min,s,tz)` | ✅ |
| `ninja::set_uniAirTemp(double, units)` | ✅ |
| `ninja::set_uniCloudCover(double, units)` | ✅ |
| `ninja::set_meshResolution(double, units)` | ✅ |
| `ninja::set_numberCPUs(int)` | ✅ |
| `ninja::simulate_wind()` | ✅ → dict de grids |
| `ninja::get_VelFileName()` | ✅ |
| `ninjaArmy::makeDomainAverageArmy(nRuns, speeds, dirs)` | ✅ |
| `ninjaArmy::startRuns(nCPUs)` | ✅ |
| Output flags (geotiff, kmz, gpkg, ascii-zip, pdf, vtk) | ✅ |

---

## 7. Evaluación de 3D Viewers — Detalle

### Three.js (Elegido)
- **Licencia**: MIT (gratuito, sin API key)
- **Terreno**: Geometry generada desde DEM, con texturas satélite ESRI
- **Selección**: Leaflet.Draw en mapa 2D, coordenadas pasadas al visor 3D
- **Overlay viento**: conos 3D con `ConeGeometry`, coloreados por velocidad
- **Time series**: slider con `requestAnimationFrame`
- **Bundle**: ~130 KB CDN, import dinámico con importmap

### Potree
- Enfocado a point clouds. No tiene modelado de viento. Descartado.

---

## 8. ALOS World 3D — Estrategia de Descarga

1. **Fuente primaria**: OpenTopography API (`https://portal.opentopography.org/API/globaldem`) — permite descargar por bounding box en GeoTIFF, soporta AW3D30, SRTM, COP30.
2. **Fallback**: Descarga directa de tiles JAXA (https://www.eorc.jaxa.jp/ALOS/en/aw3d30/data/).
3. **Caché**: Los DEMs descargados se cachean en `data/dems/{bbox_hash}.tif`.
4. **Proceso**: BBox → consulta API → mosaico si multi-tile → reproyección a UTM → ready para WindNinja.

---

## 9. Notas Técnicas

### Fase 6 — End-to-End Testing (Jun 2026)

**Estado actual: 11/11 tests PASS, backend funcional en puerto 8000.**

#### Backend verificado

| Endpoint | Estado | Notas |
|----------|--------|-------|
| `GET /health` | ✅ | `{"status":"ok"}` |
| `GET /api/config` | ✅ | Devuelve configuración |
| `GET /` | ✅ | Sirve index.html |
| `GET /static/*` | ✅ | Sirve JS/CSS/HTML |
| `POST /simulate/` | ✅ | Tarea asíncrona → task_id |
| `GET /simulate/status/{id}` | ✅ | Progreso + estados |
| `GET /simulate/result/{id}` | ✅ | Metadatos + type single/timeseries |
| `GET /simulate/grid/{id}` | ✅ | GeoJSON sampleado, ~1054 features |
| `POST /simulate/timeseries` | ✅ | 3 runs en ~6s |
| `GET /export/{id}/geotiff` | ✅ | 2-band GeoTIFF con datos válidos |
| `GET /export/{id}/gpkg` | ✅ | GeoPackage multi-capa |
| `GET /export/{id}/kmz` | ✅ | KML empaquetado en ZIP |
| `GET /export/{id}/ascii-zip` | ✅ | ASCII grids en ZIP |
| `GET /export/{id}/pdf` | ✅ | Mapa con quiver |
| `GET /export/{id}/vtk` | ✅ | VTK con vectores |
| `GET /dem/available` | ✅ | 10 DEMs listados |

#### Bugs corregidos en esta fase

1. **`from backend.app` imports rotos** (`backend/main.py:44` y 17 lugares más). El módulo `backend` no era un paquete importable. Creado `backend/__init__.py` + cambiados todos los imports a `from app.xxx`.

2. **`export_geopackage` devuelve 500** (`export.py:47`). `drv.Create("GPKG", output_path, ...)` falla si el archivo ya existe (GPKG no sobreescribe). Solución: `os.unlink(output_path)` antes de `drv.Create`.

3. **Timeseries GeoTIFF export sobrescribe archivos** (`task_manager.py:99`). `output_path.replace(".geotiff", "_0000.tif")` no coincidía porque `output_path` termina en `.tif`. Solución: `os.path.splitext` + formateo correcto.

4. **Timeseries per-file formats devuelven solo el último** (`routes/export.py`). Para formatos que producen N archivos (geotiff, pdf, vtk) con timeseries, ahora se empaquetan en ZIP.

#### Pendientes
- [x] ~~**README**: actualizar con estado actual, instrucciones de uso local, enlaces a documentación.~~
- [x] ~~**Open-Meteo API**~~: implementado `POST /api/meteo/fetch` con 3 modelos (IFS, GFS, ERA5), toggle Manual/Open-Meteo en frontend, botón "Obtener datos" que rellena tabla horaria.
- [x] ~~**Refactorización frontend**~~: módulos ES (state.js, app.js), event delegation con data-action, limpieza archivos innecesarios (export.js).
- [ ] **Añadir modelo AROME, ICON y otros**: la arquitectura backend soporta añadir modelos al dict `MODELS` en `meteo.py`, falta UI para más modelos.
- [ ] **Deploy HF Spaces**: Docker multietapa funcional, secrets (HF token), CI/CD.
- [ ] Probar frontend en navegador real (simular + exportar + time slider)
- [ ] Probar DEM fetch desde OpenTopography API
- [ ] Ejecutar lint/typecheck

- **OpenMP**: WindNinja usa multithreading. En Hugging Face Spaces con CPU limitada, configurar `set_numberCPUs(1)` o `2`.
- **GDAL**: Necesario en runtime para DEM I/O y output formats. Ya incluido en la cadena de dependencias.
- **Memoria**: Simulaciones típicas requieren ~500 MB RAM para un área de 10x10 km a 30m resolución. Para HF Spaces (16GB), limitar tamaño de área.
- **Tiempo de simulación**: ~30s-2min para dominio promedio. Usar tareas asíncronas con WebSocket SSE.
- **HF Space**: Docker runtime, cargar shared library compilada previamente como artefacto.

---

## 11. Issues Activos — Auditoría de Estructura (Jun 2026)

Issues detectados en la revisión estructural del repositorio, etiquetados por agente responsable.

### 🔵 Frontend

| # | Archivo | Severidad | Descripción |
|---|---------|-----------|-------------|
| FE-1 | `frontend/css/style.css:127-146,237-250` | 🔴 Crítico | Bloques `.spinner`, `.status-msg` y `@keyframes spin` definidos **dos veces**. Gana el último, duplica ~20 líneas. |
| FE-2 | `frontend/js/sidebar.js:237` + `simulation.js:61` | 🔴 Crítico | Función `getHourlyData()` **duplicada con contenido idéntico**. Violación DRY. |
| FE-3 | `frontend/js/viewer.js:469` + `simulation.js:142,178` | 🟠 Mayor | `updateColorScale()` declarada **sin parámetros**, pero llamada con `(p50*3.6, mx*3.6)`. Los datos se pierden. |
| FE-4 | `frontend/js/viewer.js:379` | 🟠 Mayor | `addWindArrows()` lee `appState.bbox` global en lugar de recibir el bbox como parámetro. Acoplamiento frágil. |
| FE-5 | `frontend/js/viewer.js` | 🟡 Menor | 562 líneas mezclando Leaflet + Three.js + brújula + búsqueda Nominatim. Ideal dividir en ~3 módulos. |

### 🟢 Backend

| # | Archivo | Severidad | Descripción |
|---|---------|-----------|-------------|
| BE-1 | `backend/app/core/export.py:9` | 🔴 Crítico | `from osgeo import gdal, osr, ogr` en **top-level del módulo**. Si GDAL no está instalado, casca al importar. `ninja_bridge.py` sí usa imports diferidos — inconsistencia. |
| BE-2 | `backend/app/models/schemas.py:60-61` | 🟠 Mayor | `ExportRequest(BaseModel)` definido pero **nunca usado** por ninguna ruta. Las exportaciones usan GET con `{fmt}` en path. |
| BE-3 | `backend/requirements.txt:6` vs `AGENTS.md:159` | 🟠 Mayor | `gdal==3.4.1` en requirements, pero AGENTS.md documenta `3.13.0`. Discrepancia doc/código. |
| BE-4 | `Dockerfile` (raíz) + `backend/Dockerfile` | 🟡 Menor | **Dos Dockerfiles** casi idénticos. El de raíz tiene comentario `-f backend/Dockerfile`. Crean confusión sobre cuál es el oficial. |
| BE-5 | `backend/app/core/ninja_bridge.py:246` | 🟡 Menor | `TimeSeriesSession.run_all()` crea una `NinjaSession` por run en vez de usar `ninjaArmy::makeDomainAverageArmy()` nativa. Funcional pero más lento. |

### 🟣 Robustez / Seguridad

| # | Archivo | Severidad | Descripción |
|---|---------|-----------|-------------|
| RS-1 | `backend/app/core/export.py:9` | 🔴 Crítico | Import de `osgeo` en **top-level sin try/except**. Falla catastróficamente si falta GDAL. |
| RS-2 | `tests/conftest.py:5-6` | 🟠 Mayor | `sys.path.insert(0, ...)` en vez de `pip install -e .`. Frágil, sensible al orden. |
| RS-3 | `frontend/js/viewer.js:379` | 🟠 Mayor | `addWindArrows` usa `appState.bbox` como global. Si `appState.bbox` es null/undefined, casca sin mensaje claro. |
| RS-4 | `Dockerfile` (raíz y backend/) | 🟡 Menor | Dos Dockerfiles = dos posibles imágenes diferentes. Posible deriva de configuración. |
| RS-5 | CI/CD inexistente | 🟡 Menor | `deploy-hf.yml` mencionado en AGENTS.md (sección 4, 5, 10) pero ausente de `.github/workflows/`. |

---

## 12. Arquitectura de Agentes de Refactorización

Sistema de agentes autónomos para corregir los issues activos, ejecutables en paralelo con sesiones independientes.

### 12.1 Agentes

```
┌──────────────────────────────────────────────────────────────┐
│                    ORQUESTADOR                                │
│  Planifica, decide qué agente ejecuta qué tarea,             │
│  consolida logs, detecta bloqueos, informa al usuario.       │
├───────────────────┬───────────────────┬──────────────────────┤
│   FRONTEND       │     BACKEND       │   ROBUSTEZ/SEGURIDAD │
│   🔵 FE-1 a FE-5 │   🟢 BE-1 a BE-5 │   🟣 RS-1 a RS-5     │
│                   │                   │                      │
│  + Revisión       │  + Revisión       │  + Análisis cruzado  │
│    analítica      │    analítica      │    de todo el código │
│  post-implement.  │  post-implement.  │                      │
├───────────────────┴───────────────────┴──────────────────────┤
│                      EXPLORADOR                              │
│  Mapea módulos y funciones del C++ original (src/ninja/),    │
│  documenta API, fleet_type*, arrow type de salida.           │
│  Output: catálogo de funciones exportables para pybind11.    │
└──────────────────────────────────────────────────────────────┘
```

### 12.2 Perfiles de Agente

| Agente | Objetivo | Alcance | Output |
|--------|----------|---------|--------|
| **Orquestador** | Coordinar ejecución, consolidar progreso, decidir siguiente paso | Global | `AGENTS_LOG.md` (consolidado) |
| **Frontend** | Corregir FE-1..FE-5 + revisión analítica post-cambio | `frontend/` | Log parcial + PR de cambios |
| **Backend** | Corregir BE-1..BE-5 + revisión analítica post-cambio | `backend/` | Log parcial + PR de cambios |
| **Robustez** | Corregir RS-1..RS-5 + análisis de seguridad/edge cases en todo el código | Todo el repo | Log parcial + reporte de análisis |
| **Explorador** | Mapear C++ original (`src/ninja/`), documentar API de salida, tipos de flecha | `src/ninja/`, `backend/lib/bindings.cpp` | Catálogo de funciones + `EXPLORER_REPORT.md` |

### 12.3 Ciclo de Vida

```
  ┌──────────┐
  │ ORQUESTA │── decide tarea ──→ ┌──────────┐
  │   DOR    │                    │ FRONTEND │
  │          │←── log + review ──│ BACKEND  │
  │          │                    │ ROBUSTEZ │
  │          │── decide tarea ──→ │ EXPLOR.  │
  │          │←── log + report ──│          │
  │          │                    └──────────┘
  │          │── informa al usuario ──→ [humano]
  └──────────┘
```

Por cada tarea:

1. **Orquestador** selecciona agente y tarea según prioridad y dependencias.
2. **Agente** ejecuta cambios con permisos de escritura en el repo.
3. **Frontend/Backend** realizan *revisión analítica* del código modificado antes de registrar el avance.
4. **Robustez** analiza el código completo tras cada implementación.
5. **Orquestador** consolida logs en `AGENTS_LOG.md`.
6. Si hay bloqueo o tarea compleja, orquestador pide al usuario ejecutar el agente en otra sesión.

### 12.4 Prioridades de Ejecución

| Prioridad | Issues | Justificación |
|-----------|--------|---------------|
| P0 (inmediata) | FE-2, BE-1, RS-1 | Código duplicado e imports frágiles que pueden romper en producción |
| P1 (alta) | FE-1, FE-3, RS-2 | CSS duplicado, funciones que ignoran argumentos, tests frágiles |
| P2 (normal) | FE-4, BE-2, BE-3 | Acoplamientos, dead code, discrepancia doc/código |
| P3 (baja) | FE-5, BE-4, BE-5, RS-4, RS-5 | Refactor menor, Dockerfiles, CI/CD |

### 12.5 Dependencias entre Issues

```
FE-2 (duplicación getHourlyData) → requiere decidir si la función vive en sidebar.js o simulation.js
BE-1 (import osgeo top-level) → RS-1 (mismo issue, perspectiva robustez)
BE-3 (GDAL version) → requiere decidir versión definitiva y actualizar requirements.txt + AGENTS.md
RS-4 (Dockerfiles duplicados) → BE-4 (mismo issue)
```

### 12.6 Formato de Reporte en AGENTS_LOG.md

Cada agente escribe en este formato:

```markdown
## [2026-06-23 10:30] Agente: Frontend | Tarea: FE-1 | Estado: ✅ Completado

### Cambios realizados
- `frontend/css/style.css`: eliminado bloque duplicado de `.spinner`/`.status-msg` (líneas 237-250)

### Revisión analítica
- Impacto: ninguna regresión visual esperada
- Riesgo: bajo
- Cobertura: los selectores duplicados tenían menor especificidad, no había diferencia funcional

### Log
[2026-06-23 10:28] Inicio
[2026-06-23 10:29] Editado style.css: eliminadas líneas 237-250
[2026-06-23 10:30] Revisión OK
```

### 12.7 Protocolo de Comunicación

- Cada agente escribe su log en `AGENTS_LOG.md` bajo una sección con su nombre.
- El orquestador consolida al final de cada ronda.
- Si un agente encuentra un bloqueo (dependencia no resuelta, decisión técnica), lo marca con `🚧 BLOQUEO` y el orquestador decide si:
  a) Resolverlo con otro agente
  b) Preguntar al usuario
- Los agentes pueden comunicarse indirectamente a través del log y del estado del repo (git status).

### 12.8 Ejecución en Sesiones Paralelas

El orquestador puede ejecutar agentes en paralelo siempre que:
1. No modifiquen los mismos archivos (sin conflictos de merge)
2. No tengan dependencias entre sí

Pares paralelizables:
- `Frontend + Backend` → modifican directorios distintos
- `Explorador + cualquier otro` → solo lee `src/ninja/`, no escribe
- `Robustez` → puede ejecutarse en cualquier momento, solo lee

No paralelizables (dependencia directa):
- `Robustez` después de `Frontend` o `Backend` (necesita el código modificado para analizarlo)

Para lanzar en sesión separada, el orquestador indica:
```bash
# Sesión 1: Agente Frontend
# -- Ejecutar en terminal aparte --
# Comando: [a definir]
```

---

## 13. Modos de Solver: CoM vs CoMM (Futuro)

### 13.1 Descripción

WindNinja ofrece dos modos de simulación seleccionables por el usuario:

| Modo | Clase C++ | Solver | Descripción |
|------|-----------|--------|-------------|
| **Conservation of Mass (CoM)** | `ninja` | CG + MINRES (nativo) | Elementos finitos de Galerkin, ajusta campo de viento para satisfacer continuidad |
| **Conservation of Mass and Momentum (CoMM)** | `NinjaFoam` (hereda de `ninja`) | OpenFOAM `simpleFoam` | CFD completo con modelo de turbulencia k-epsilon, condiciones de borde personalizadas |

### 13.2 Estado Actual en la Web

| Componente | CoM | CoMM |
|------------|:---:|:----:|
| C++ Core (`ninja` / `NinjaFoam`) | ✅ | ✅ |
| Compilado con `-DNINJAFOAM` | ✅ | ✅ |
| Binding `makeDomainAverageArmy(momentumFlag)` | ✅ | ✅ (default `false`) |
| `ninja_bridge.py` (`NinjaSession`) | ✅ `Ninja()` directo | ❌ No implementado |
| API REST (`SimulationRequest`) | ✅ | ❌ Sin campo `momentum_flag` |
| Frontend UI | ✅ | ❌ Sin control |

Actualmente la web usa exclusivamente CoM. CoMM está compilado en la shared library pero no accesible desde Python.

### 13.3 Dependencia: OpenFOAM

`NinjaFoam` requiere OpenFOAM en **runtime** — ejecuta `blockMesh`, `simpleFoam`, etc. como subprocesos. Consideraciones:

- OpenFOAM es un paquete CFD masivo (~1-2 GB con dependencias)
- En HF Spaces habría que instalarlo en el Dockerfile (`apt install openfoam` o compilar desde fuente)
- Alternativa: embeber binarios mínimos de OpenFOAM
- Sin OpenFOAM, CoMM lanza excepción: `"momentumFlag cannot be set to true. WindNinja was not compiled with mass and momentum support."`

### 13.4 Bindings Faltantes para CoMM

Los siguientes métodos de `NinjaFoam` (en `src/ninja/ninja.h:271-281`) **no están expuestos en pybind11**:

```cpp
void set_NumberOfIterations(int nIterations);
void set_MeshCount(int meshCount);
void set_MeshCount(WindNinjaInputs::eNinjafoamMeshChoice meshChoice);
void set_ExistingCaseDirectory(std::string directory);
void set_foamVelocityGrid(AsciiGrid<double> velocityGrid);
void set_foamAngleGrid(AsciiGrid<double> angleGrid);
void set_writeTurbulenceFlag(bool flag);
void set_colMaxSampleHeightAGL(double, lengthUnits::eLengthUnits);
```

### 13.5 Plan de Implementación Futura

1. **Bindear setters de NinjaFoam** en `backend/lib/bindings.cpp`
2. **Añadir `momentum_flag: bool = False`** a `SimulationConfig` y `SimulationRequest`
3. **Crear `NinjaFoamSession`** en `ninja_bridge.py` que use `ninjaArmy.makeDomainAverageArmy(nRuns=1, momentumFlag=True)`
4. **Instalar OpenFOAM** en el Dockerfile (o crear imagen separada)
5. **Añadir toggle en frontend** (sidebar) para elegir solver
6. **Documentar limitaciones**: CoMM es ~10x más lento, requiere más memoria, pero produce campos de viento más realistas en terrenos complejos

---
