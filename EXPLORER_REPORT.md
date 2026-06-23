# EXPLORER_REPORT

## 1. Original WindNinja Arrow Style

### 1.1 Arrow Geometry (C++)

La flecha se genera en `src/ninja/wn_Arrow.cpp` (clase `WN_Arrow`). Es una **flecha lineal OGR** (no un polígono relleno), compuesta por 5 puntos en un `wkbLineString`:

```
head_right → tip → head_left → tip → tail
```

**Cálculo de puntos** (`_computeVectorPoints()`):

| Variable | Fórmula | Valor típico |
|----------|---------|-------------|
| `yscale` | `0.5 * (scale_factor * (i+1))` para el bucket que contiene `speed` | 0.5–0.5 |
| `xscale` | `yscale * 0.40` | 20% de yscale |
| `ypt` (longitud) | `cell_size * yscale` | 0.5 × cell_size |
| `xpt` (ancho cabeza) | `cell_size * xscale` | 0.2 × cell_size |

La dirección sigue convención meteorológica (de dónde viene el viento):
```cpp
theta = 360 - (dir + 180);   // conversion a "hacia dónde va"
```

Se usan `m_nsplits` thresholds para escalar la flecha según velocidad (5 buckets). Si speed=0, dibuja una "X" (cruz de 4 puntos).

### 1.2 Draw en GDAL (`gdal_output.cpp:150-241`)

La función `drawArrow()` genera un `OGRMultiLineString` con 3 segmentos:
- **tail → tip** (cuerpo)
- **tip → head_left** (barba izquierda)
- **tip → head_right** (barba derecha)

Parámetros: `arrowLength = 40` (no en píxeles reales, sino relativo a cell_size).

### 1.3 Color Mapping

Esquema de 5 colores en todos los formatos de salida:

| Bucket | Color OGR | Hex | Line Width |
|--------|-----------|-----|------------|
| 1 (más bajo) | Blue | `#0000ff` | 1.0× |
| 2 | Green | `#00ff00` | 1.5× |
| 3 | Yellow | `#ffff00` | 1.75× |
| 4 | Orange | `#ffa500` | 3.0× |
| 5 (más alto) | Red | `#ff0000` | 4.0× |

El ancho de línea escala con velocidad (line width multiplicativo). En la leyenda BMP, las flechas se dibujan con `arrowLength=40px`, `arrowHeadLength=10px`.

En OutputWriter (formato shapefile), se usa `OGR_STYLE` con `PEN(c:color;w:10px)` y colores por speed.

### 1.4 OutputWriter Arrow

`OutputWriter.cpp:770-810` itera sobre el grid completo y por cada celda:
1. Obtiene posición (x, y) con `spd.get_cellPosition(i, j, &x, &y)`
2. Crea `WN_Arrow(x, y, speed, dir, cellSize, split_vals, NCOLORS)`
3. Convierte a geometría OGR (`arrow.asGeometry(hLine)`)
4. Transforma coordenadas (`OGR_G_Transform`)
5. Asigna estilo según velocidad (`_getStyleFromSpeed()`)

### 1.5 GUI Qt

No se encontró dibujo de flechas en `src/gui/` (grep de "arrow" y "cone" sin resultados). La GUI Qt usa el backend OGR para visualización, no dibuja flechas directamente.

### 1.6 KML Vector (`KmlVector.cpp`)

Los arrows en KMZ usan el mismo approach: `arrowLength=40px`, `arrowHeadLength=10px`, con colores en espacio RGBA (rojo, naranja, amarillo, verde, azul). El ancho de línea escala: `redWidth=4.0*lineWidth`.

---

## 2. qgis2threejs Export

### 2.1 Arquitectura del Plugin

Qgis2threejs (v3.0, mayo 2026) es un plugin QGIS que exporta escenas 3D a HTML independiente. Usa Three.js r184.

**Estructura de directorios del output:**

```
output_dir/
├── 3DViewer.html          # Template Jinja2 renderizado
├── index/                  # Datos de la escena
│   ├── scene.json          # Metadatos + estructura de capas
│   ├── a0.bin              # Grid DEM (binario, float32/uint16)
│   ├── a0.png              # Textura del tile
│   ├── b0.json / b0.bin    # Datos de vectores
│   └── ...
├── js/                     # Código JS copiado
│   ├── Qgis2threejs.js     # Framework principal
│   ├── viewer.js           # Preview mode + web channel bridge
│   └── lib/threejs/        # Three.js r184 + loaders
└── css/
    └── viewer.css
```

### 2.2 Formato scene.json

```json
{
  "type": "scene",
  "properties": {
    "height": 90.1,
    "width": 100.0,
    "baseExtent": [xmin, ymin, xmax, ymax],
    "crs": "EPSG:3857",
    "proj": "+proj=merc +a=6378137...",
    "rotation": 0,
    "wgs84Center": {"lat": 47.39, "lon": 6.52},
    "zExaggeration": 1.0,
    "zShift": 0.0
  },
  "layers": [
    {
      "type": "layer",
      "id": 0,
      "properties": {
        "name": "clip_dtm",
        "queryable": 1,
        "visible": true,
        "type": "dem",
        "shading": true
      },
      "data": [
        {
          "type": "block",
          "layer": 0,
          "block": 0,
          "grid": {"width": 211, "height": 190, "url": "./data/index/a0.bin"},
          "width": 100.0,
          "height": 90.1,
          "translate": [0, 0, 0],
          "zScale": 0.038,
          "zShift": 0.0,
          "material": {"type": 0, "image": {"url": "./data/index/a0.png"}, "ds": 1},
          "sides": true
        }
      ]
    }
  ]
}
```

### 2.3 Carga de Datos

Dos modos:
1. **`app.loadJSONFile(url)`** — carga scene.json desde URL
2. **`app.loadJSONObject(obj)`** — carga el JSON directamente (útil para Django, la escena se pasa inline)

Los datos vectoriales se envían como bloques JSON con geometrías y atributos. Usa `QWebChannel` para comunicación bidireccional entre Python (QGIS) y JS en modo preview.

### 2.4 Templates HTML

Tres templates disponibles:
- `3DViewer.html` — template principal con panel de capas, control de cámara, medición de distancias
- `3DViewer(dat-gui).html` — con dat.GUI para controles
- `Mobile.html` — versión táctil con iconos Font Awesome

Los templates usan placeholders `${scripts}`, `${title}`, `${version}`, `${narration}`.

### 2.5 Relevancia para WindNinja Web

La arquitectura de qgis2threejs es un **precedente directo**: misma tecnología (Three.js), mismo concepto (DEM + vectores en 3D). Diferencias clave:
- qgis2threejs genera HTML **estático** (no necesita servidor)
- WindNinja Web usa **API dinámica** (FastAPI) + renderizado en tiempo real
- qgis2threejs usa archivos binarios (.bin) para grids → WindNinja Web usa GeoJSON
- qgis2threejs usa QWebChannel (Qt) → WindNinja Web usa HTTP REST

---

## 3. Missing Modules for HF Spaces

### 3.1 CI/CD

| Elemento | Estado | Archivo |
|----------|--------|---------|
| `deploy-hf.yml` | ❌ **No existe** | `.github/workflows/deploy-hf.yml` |
| `.huggingface/` dir | ❌ No existe | — |
| HF README.md | ❌ No existe | — |

Aunque AGENTS.md (secciones 4, 5, 10) menciona `deploy-hf.yml`, el archivo no está en el repo.

### 3.2 Dockerfiles

| Archivo | Problema |
|---------|----------|
| `Dockerfile` (raíz) | Comentario: `# Build from repo root: docker build -f backend/Dockerfile .` — debería ser `docker build .` sin `-f` |
| `backend/Dockerfile` | Casi idéntico al de raíz, salvo: `-j$(nproc)` vs `-j2`, y no instala numpy antes de gdal |

Ambos hacen `COPY . /repo` desde el context root, lo que incluye `src/` (C++), `autotest/`, etc. en la imagen.

**Problemas detectados:**
1. **GDAL version mismatch**: `requirements.txt:6` → `gdal==3.4.1`, pero AGENTS.md y README documentan `3.13.0`. El Dockerfile instala `libgdal-dev` (Ubuntu 22.04 = ~3.4.1), pero el sistema del desarrollador (Arch) usa 3.13.0.
2. **pybind11 build**: `cmake --build /build -j2` → limitado a 2 cores. Usar `-j$(nproc)` sería mejor.
3. **`windninja_core*.so`**: El glob `cp /build/windninja_core*.so /repo/backend/lib/` podría fallar si el nombre real difiere.

### 3.3 Python Import Graceful Degradation

`ninja_bridge.py:30-47` (`_load_core()`):
```python
try:
    import windninja_core
    _core = windninja_core
except ImportError as e:
    raise RuntimeError(...) from e  # ← Hard fail, sin mock mode
```

No hay modo mock/fallback para desarrollo sin C++ compilado. Los tests usan mock (`tests/test_simulation.py`), pero la app en producción sin `windninja_core` falla catastróficamente.

### 3.4 Data Files

`ninja_bridge.py:52` busca `data/date_time_zonespec.csv` relativo a `backend/app/core/../../..` = raíz del proyecto. En Docker, `data/` se copia a `/app/data/` y la variable `WINDNINJA_DATA=/app/data` está definida, pero el código no usa `WINDNINJA_DATA` — usa rutas relativas.

### 3.5 Checklist de Pendientes (AGENTS.md §9)

| Pendiente | Estado |
|-----------|--------|
| Añadir modelo AROME, ICON | ❌ Pendiente |
| Deploy HF Spaces | ❌ Pendiente (faltan CI/CD, secrets) |
| Probar frontend en navegador real | ❌ Pendiente |
| Probar DEM fetch OpenTopography | ❌ Pendiente |
| Ejecutar lint/typecheck | ❌ Pendiente |
| End-to-end tests | ❌ Pendiente |

---

## 4. Arrow Scaling Proposal

### 4.1 Estado Actual (`viewer.js:379-425`)

```javascript
const SPEED_BUCKETS = [
    { max: 10, color: '#2196F3', size: 0.5 },
    { max: 20, color: '#4CAF50', size: 0.75 },
    { max: 30, color: '#FFC107', size: 1.0 },
    { max: 60, color: '#FF9800', size: 1.3 },
    { max: Infinity, color: '#F44336', size: 1.6 },
];

const baseSize = 300;          // ← fijo, independiente del escenario
const smallLen = baseSize * bucket.size;  // 150 a 480 unidades Three.js
const coneR = smallLen * 0.04;            // 6 a 19.2 unidades
```

**Problemas:**
- `baseSize = 300` es arbitrario — funciona para escenarios de ~10×10 km, pero para escenarios grandes (100×100 km) las flechas son diminutas, y para pequeños (1×1 km) son enormes.
- No hay relación con `demCellW` / `demCellH` ni con el bounding box.
- Las flechas se recrean completas en cada time step (`clearWindArrows()` + `addWindArrows()`) — ineficiente.

### 4.2 Propuesta de Escalado Dinámico

Basado en el bounding box del escenario:

```javascript
function computeArrowScale(bbox) {
    const lat = (bbox.north + bbox.south) / 2 * Math.PI / 180;
    const mPerDegLon = 111320 * Math.cos(lat);
    const sceneWidthM = (bbox.east - bbox.west) * mPerDegLon;
    const sceneHeightM = (bbox.north - bbox.south) * 111320;
    const maxDim = Math.max(sceneWidthM, sceneHeightM);
    // La flecha debe ser ~2-4% del escenario
    const targetArrowLen = maxDim * 0.03;
    return targetArrowLen;
}
```

**Algoritmo propuesto:**
1. Calcular `targetArrowLen = max(sceneWidth, sceneHeight) * 0.03` (3% del escenario)
2. Usar `targetArrowLen` como `baseSize` (en lugar de 300 fijo)
3. Los `bucket.size` multiplicativos (0.5–1.6) mantienen la diferenciación visual entre velocidades
4. El radio del cono: `coneR = smallLen * 0.06` (ligeramente más grueso que el 0.04 actual para mejor visibilidad)
5. Opcional: añadir un shaft cilíndrico delgado (`CylinderGeometry`) entre la base y la punta del cono para mayor realismo, replicando el estilo "línea + cabeza" del C++ original.

### 4.3 Color Mapping: Alinear con el C++ Original

Para ser fiel al WindNinja original, se debería cambiar la paleta:

```javascript
const SPEED_BUCKETS = [
    { max: 10, color: '#0000ff', size: 0.5 },   // Blue (original)
    { max: 20, color: '#00ff00', size: 0.75 },   // Green
    { max: 30, color: '#ffff00', size: 1.0 },   // Yellow
    { max: 60, color: '#ffa500', size: 1.3 },   // Orange
    { max: Infinity, color: '#ff0000', size: 1.6 }, // Red
];
```

Nota: la paleta actual (`#2196F3`, `#4CAF50`, etc.) usa Material Design colors, no los del C++. Si se desea consistencia con el original, hay que cambiar.

### 4.4 Optimización: Object Pooling

En lugar de `clearWindArrows()` + recrear todos los Meshes en cada time step:
- Crear un **pool de Meshes** reutilizables (número máximo = grid cells)
- En cada frame, actualizar `cone.position`, `cone.quaternion`, `cone.material.color` y `cone.scale`
- Los no usados: `cone.visible = false`

### 4.5 Mejoras Adicionales

| Mejora | Descripción |
|--------|-------------|
| **Arrow shaft** | Añadir `CylinderGeometry` entre tail y tip para imitar el estilo del C++ (línea + cabeza) |
| **Opacity por elevación** | Flechas detrás de colinas con alpha reducido |
| **Label de velocidad** | TextSprite sobre flechas más rápidas |
| **LOD** | Reducir segmentos del cono (8→6) para flechas lejanas |
| **InstancedMesh** | Usar `InstancedMesh` para todas las flechas del mismo bucket (1 draw call por color) |

---

## 5. Recommended Next Steps

### 5.1 Prioridad Inmediata (Pre-Deploy)

1. **Crear `deploy-hf.yml`** — CI/CD para Hugging Face Spaces, con HF_TOKEN como secret
2. **Unificar Dockerfiles** — eliminar `backend/Dockerfile` o `Dockerfile` (raíz), documentar el oficial
3. **Corregir GDAL version** — decidir si 3.4.1 (Ubuntu 22.04) o 3.13.0 (Arch) y actualizar `requirements.txt` + `AGENTS.md`
4. **Añadir mock mode** — en `ninja_bridge.py`, que si falla `import windninja_core`, cargue un mock con datos sintéticos

### 5.2 Arrow Implementation

5. **Implementar escalado dinámico** de flechas según bounding box (sección 4.2)
6. **Alinear colores** con la paleta original del C++ (sección 4.3)
7. **Implementar object pooling** para time series (sección 4.4)
8. **Añadir shaft cilíndrico** a las flechas 3D (sección 4.5)

### 5.3 qgis2threejs Inspiración

9. **Evaluar export a HTML estático** similar a qgis2threejs como feature adicional (generar ZIP descargable con escena Three.js autónoma)
10. **Considerar formato binario** para grids grandes en lugar de GeoJSON (los .bin de qgis2threejs son más eficientes)

### 5.4 Testing y Lint

11. **Ejecutar lint** y typecheck en el código existente
12. **Test end-to-end** con frontend real (Selenium/Playwright)
13. **Test DEM fetch** con OpenTopography API
