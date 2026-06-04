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
│  │  │ Side Panel   │ │ 3D Viewer (Cesium/Three) │ │      │
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

| Opción | Pros | Contras |
|--------|------|---------|
| **Cesium.js** | ✅ Terreno global, selección de área nativa, clima/atmosfera, mediciones 3D. Buen soporte GeoJSON/KML. Gratuito sin API key. | Peso grande (pero tree-shakeable). Curva de aprendizaje. |
| Three.js | ✅ Ligero, flexible. | No tiene globo terráqueo ni terreno por defecto. Todo custom. |
| Potree | Excelente para nubes de puntos, no para simulación. | No es lo que necesitamos. |
| **Cesium for Unreal** | No, sobrekill web. | — |

✅ **RECOMENDADO: Cesium.js** — Tiene globe 3D integrado, selección de bounding box, terreno Cesium World Terrain, y podemos superponer las flechas de viento como entities 3D.

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
- [x] Frontend scaffold (sidebar colapsable, Cesium viewer stub, simulation/export)
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
- [x] Integración Cesium.js con globe 3D y Cesium World Terrain
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
- [x] GDAL version pinned a 3.4.1
- [x] Temp file cleanup con BackgroundTasks
- [x] .env excluido del build (token va como Secret de HF)
- [x] Documentación completa en AGENTS.md (arquitectura, decisiones, auditorías)
- [x] Pre-deployment audit: 12 issues corregidos (4 blocker, 4 critical, 4 major)

---

## 10. Post-Fase: Auditoría

Cada fase incluye una auditoría post-entrega. Los hallazgos se registran aquí.

### Fase 0 — Hallazgos de Auditoría

**Críticos (corregidos):**
1. `frontend/js/viewer.js:13` — `Cesium.Draw` no existe en CesiumJS moderno. Reemplazado con `ScreenSpaceEventHandler` + dibujo manual de rectángulo.
2. `backend/lib/bindings.cpp` — No se exponían getters de grids de resultado. Añadidos `get_outputSpeedGrid`, `get_outputDirectionGrid`, `get_outputGridProjection`, etc. como wrappers numpy.
3. `backend/app/main.py:7,11` — Paths relativos rotos a `frontend/`. Corregido con `Path(__file__).resolve()`.

**Mayores (corregidos):**
4. `backend/lib/CMakeLists.txt:87,98` — Variable `OPENMP_FOUND` vs `OpenMP_FOUND` (case-sensitive). Corregido.
5. `backend/lib/CMakeLists.txt:78` — Falta fallback pkg-config para shapelib en Linux. Añadido.
6. `backend/lib/CMakeLists.txt:98-99` — `find_package(OpenMP REQUIRED)` redundante. Simplificado.
7. `backend/Dockerfile` — Stage 1 innecesario (no se enlaza contra libninja). Simplificado a 2 stages.
8. `.github/workflows/deploy-hf.yml:26-28` — Push a ghcr.io en vez de registry.huggingface.co. Corregido.
9. `backend/app/core/ninja_bridge.py:14-16` — `simulate()` era no-op. Pendiente para Fase 1.

**Menores (documentados):**
10. `frontend/js/viewer.js:1` — Token Cesium Ion vacío. Añadir registro gratuito para terreno de alta resolución.
11. `backend/app/models/schemas.py:24-25` — Validación de longitudes de listas en TimeseriesRequest pendiente.
12. `backend/app/models/schemas.py:31` — `fmt` debería ser `Literal` en vez de `str`.

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
14. `tests/test_simulation.py:138,151,162,174,183,194` — Archivos temporales no limpiados si test falla (sin try/finally). Documentado como mejora futura.

**Pendientes para Fase 2:**
15. `backend/lib/bindings.cpp:16-24` — `as_numpy` no preserva referencia al objeto C++ dueño del buffer. Mitigado por `.copy()` en `ninja_bridge.py`. Para mejorar: pasar `py::object self` como parent del array.
16. `backend/lib/bindings.cpp:200-208` — Bindings de `OutputWriter` requieren `AsciiGrid<double>`, no invocables desde Python. Son vestigiales (export.py usa GDAL puro). Considerar eliminar o convertir a wrappers numpy.
17. `backend/app/models/schemas.py:31` — `fmt` debería ser `Literal` en vez de `str`.

### Fase 5 — Hallazgos de Auditoría (Pre-Deploy)

**Blocker (corregidos):**
1. `frontend/index.html:5,11,23` — Static mount mismatch: `backend/app/main.py` monta `/static` pero HTML referenciaba URLs sin prefijo. Corregido: rutas `js/...` → `/static/js/...` y añadido `widgets.css` de Cesium.
2. `backend/app/routes/export.py` — Temp files sin cleanup. Archivos creados por `export_to_format()` nunca se eliminaban tras servir la respuesta. Corregido: `NamedTemporaryFile` + `BackgroundTasks.add_task(_cleanup)`.
3. `frontend/index.html` — Faltaba `widgets.css` de Cesium (solo se incluía `Cesium.js`). Corregido: añadido link a `Widgets/widgets.css`.
4. `backend/app/core/ninja_bridge.py:10-12` — `from osgeo import gdal, osr` al nivel del módulo → falla si GDAL no está instalado en import. Corregido: imports diferidos dentro de `_run()` y `find_gdal_data()`.

**Critical (corregidos):**
5. `backend/app/routes/simulation.py:97-108` — DEM subido se ignoraba en el payload. El path del DEM subido no se pasaba al `SimulationRequest.user_dem_path`. Corregido: endpoint `POST /simulate` recibe `user_dem_path` y lo pasa a `ninja_bridge`.
6. `backend/app/core/ninja_bridge.py:152-167` — `TimeSeriesSession.configure()` no propagaba `mesh_resolution` a `setMeshResolution(i)`. Corregido.
7. `backend/app/core/ninja_bridge.py:77` — `startRuns(2)` hardcodeado. Corregido: usa `self._n_cpus`.
8. `backend/app/core/task_manager.py:42-45` — `_tasks` dict accedido sin lock desde `get_status()`. Corregido: `with self._lock:` en todos los accesos.

**Major (corregidos):**
9. `backend/app/routes/dem.py:33-38` — Upload DEM filename generado con `dem_cache.store_path()` que depende de bbox (0,0,0,0) → colisión de hash. Corregido: `uuid4()[:8]` + `DEM_CACHE_DIR`.
10. `backend/app/main.py` — Sin CORS middleware. Las peticiones desde el frontend JS al backend son cross-origin en HF Spaces. Corregido: `CORSMiddleware(allow_origins=["*"])`.
11. `backend/requirements.txt` — GDAL sin version pin. Corregido: `gdal==3.4.1` (Ubuntu 22.04).
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
│       ├── viewer.js            # Cesium viewer setup
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

### Cesium.js (Recomendado)
- **Licencia**: Apache 2.0 (gratuito, sin API key requerida en self-hosted)
- **Globo**: sí, con Cesium World Terrain (terreno global 3D)
- **Selección**: `ScreenSpaceEventHandler` + `Draw` (rectangle/polygon)
- **Overlay viento**: entities con billboards/vectors, o `CustomDataSource`
- **Time series**: `Clock` widget nativo con `Timeline`
- **DEM**: Cesium Terrain o terrain propio desde GeoTIFF
- **Bundle**: ~130 KB gzip con tree-shaking, o CDN

### Three.js
- Requiere implementar globe + terreno desde cero (o usar `three-globe` que es liviano pero no tiene terreno)
- Flechas 3D: `ArrowHelper` — fácil
- Time series: custom con `requestAnimationFrame`

### Potree
- Enfocado a point clouds. No tiene globe ni modelado de viento. Descartado.

**Conclusión**: **Cesium.js** da globe 3D, terreno, selección de área y animación temporal out of the box. Three.js si queremos algo ultra-ligero y custom, pero implica mucho más trabajo.

---

## 8. ALOS World 3D — Estrategia de Descarga

1. **Fuente primaria**: OpenTopography API (`https://portal.opentopography.org/API/globaldem`) — permite descargar por bounding box en GeoTIFF, soporta AW3D30, SRTM, COP30.
2. **Fallback**: Descarga directa de tiles JAXA (https://www.eorc.jaxa.jp/ALOS/en/aw3d30/data/).
3. **Caché**: Los DEMs descargados se cachean en `data/dems/{bbox_hash}.tif`.
4. **Proceso**: BBox → consulta API → mosaico si multi-tile → reproyección a UTM → ready para WindNinja.

---

## 9. Notas Técnicas

- **OpenMP**: WindNinja usa multithreading. En Hugging Face Spaces con CPU limitada, configurar `set_numberCPUs(1)` o `2`.
- **GDAL**: Necesario en runtime para DEM I/O y output formats. Ya incluido en la cadena de dependencias.
- **Memoria**: Simulaciones típicas requieren ~500 MB RAM para un área de 10x10 km a 30m resolución. Para HF Spaces (16GB), limitar tamaño de área.
- **Tiempo de simulación**: ~30s-2min para dominio promedio. Usar tareas asíncronas con WebSocket SSE.
- **HF Space**: Docker runtime, cargar shared library compilada previamente como artefacto.
