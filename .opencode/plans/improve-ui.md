# Plan: Mejoras UI (v27)

## 1. Footer: "NinjaStorm" → "WindNinja" + centrado

### index.html (línea 16)
Cambiar:
```html
<a href="https://ninjastorm.firelab.org/windninja/" target="_blank" rel="noopener">NinjaStorm</a>
```
a:
```html
<a href="https://ninjastorm.firelab.org/windninja/" target="_blank" rel="noopener">WindNinja</a>
```

### style.css
En `#sidebar-footer` añadir `justify-content: center;`

---

## 2. Brújula: reemplazar canvas por flecha HTML giratoria

El canvas actual no se ve. Cambiar a un `<div>` con un triángulo ▲ que rota vía CSS transform.

### index.html
Reemplazar:
```html
<canvas id="compass-canvas" width="120" height="120"></canvas>
```
por:
```html
<div id="compass-arrow">▲</div>
```

### style.css
Reemplazar:
```css
#compass-canvas {
    position: absolute; bottom: 20px; left: 20px;
    z-index: 1000; width: 120px; height: 120px;
    pointer-events: none;
    filter: drop-shadow(0 2px 8px rgba(0,0,0,0.7));
}
```
por:
```css
#compass-arrow {
    position: absolute; bottom: 24px; left: 24px;
    z-index: 1000; font-size: 28px; color: #ff4444;
    pointer-events: none;
    text-shadow: 0 0 10px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.8);
    line-height: 1;
    transition: none;
    font-family: system-ui, sans-serif;
}
```

### viewer.js
Reemplazar `_setupCompass` y `_updateCompass`:

```javascript
/* ---- Compass arrow (simple rotating triangle) ---- */
function _setupCompass() {}
function _updateCompass() {
  const el = document.getElementById('compass-arrow');
  if (!el || !camera || !controls) return;
  const dx = camera.position.x - controls.target.x;
  const dz = camera.position.z - controls.target.z;
  if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return;
  const deg = Math.atan2(dx, dz) * 180 / Math.PI;
  el.style.transform = `rotate(${deg}deg)`;
}
```

---

## 3. Colores discretos: 5 rangos, 5 colores, 5 tamaños

### viewer.js — `_addWindArrows` (líneas 380-427)
Reemplazar el cálculo de color y tamaño con tabla discreta:

```javascript
const BUCKETS = [
  { max: 10, color: '#2196F3', size: 0.5 },
  { max: 20, color: '#4CAF50', size: 0.75 },
  { max: 30, color: '#FFC107', size: 1.0 },
  { max: 60, color: '#FF9800', size: 1.3 },
  { max: Infinity, color: '#F44336', size: 1.6 },
];
// ...
const speed_k = speed * 3.6;
const bucket = BUCKETS.find(b => speed_k <= b.max) || BUCKETS[BUCKETS.length - 1];
const baseSize = 300;
const smallLen = baseSize * bucket.size;
const coneR = smallLen * 0.04;
// ...
const arrowColor = new THREE.Color(bucket.color);
```

### viewer.js — `updateColorScale`
Cambiar a mostrar los 5 thresholds fijos:

```javascript
window.updateColorScale = function (p50_kmh, max_kmh) {
  const maxEl = document.getElementById('color-scale-max');
  const midEl = document.getElementById('color-scale-mid');
  const minEl = document.getElementById('color-scale-min');
  if (!maxEl) return;
  maxEl.textContent = '>60 km/h';
  midEl.textContent = '30 km/h';
  minEl.textContent = '0 km/h';
};
```

La escala de color sigue siendo un gradiente lineal, pero las etiquetas ahora marcan los thresholds discretos.

---

## 4. Capas 3D: corregir URLs ESRI + feedback visual

### backend/app/routes/map.py (líneas 21-25)
Cambiar `services.arcgisonline.com` → `server.arcgisonline.com`:

```python
ESRI_URLS = {
    "satellite": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export",
    "standard": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/export",
    "hybrid": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/export",
}
```

### viewer.js — `changeLayer` (línea 213)
Añadir feedback al usuario cuando falla la textura:

```javascript
} catch (err) {
  console.warn('Texture change failed:', err);
  setStatus?.('Error al cambiar textura: ' + err.message, 'error');
}
```

---

## 5. Bump cachebuster

`index.html`: todas las `v=26` → `v=27`
