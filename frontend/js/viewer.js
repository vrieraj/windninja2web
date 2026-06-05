let THREE, OrbitControls;
const appState = window.appState;

let map, drawControl, drawnItems, rectLayer;
let currentTileLayer = null;
let current2DLayerName = 'satellite';

let scene, camera, renderer, controls, terrainMesh, animId;
let windArrows = [], geoJson3DObjects = [];
let demElevations, demNcols, demNrows, demCellW, demCellH, demCenterX, demCenterZ;
let northArrow = null;
let currentView = '2d';

const tileLayers = {};

function is3D() { return currentView === '3d'; }

async function _loadThree() {
  if (THREE) return;
  const mod = await import('three');
  THREE = mod;
  const addon = await import('three/addons/controls/OrbitControls.js');
  OrbitControls = addon.OrbitControls;
}

/* ---- Layer bar (tab-style, bottom-left) ---- */
function _switch2DLayer(name) {
  if (currentTileLayer) map.removeLayer(currentTileLayer);
  current2DLayerName = name;

  if (name === 'hybrid') {
    currentTileLayer = L.layerGroup([
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { maxZoom: 19 }),
      L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
        maxZoom: 19, opacity: 0.6,
      }),
    ]).addTo(map);
  } else {
    currentTileLayer = tileLayers[name].addTo(map);
  }
  _updateLayerBar(name);
}

function _updateLayerBar(name) {
  document.querySelectorAll('.layer-btn').forEach(b => b.classList.toggle('active', b.dataset.layer === name));
}

const LayerBar = L.Control.extend({
  options: { position: 'bottomleft' },
  onAdd: function () {
    const div = L.DomUtil.create('div', 'leaflet-layer-bar');
    div.innerHTML = ['satellite', 'hybrid', 'standard'].map(n =>
      `<button class="layer-btn${n === 'satellite' ? ' active' : ''}" data-layer="${n}">${
        { satellite: 'Satélite', hybrid: 'Híbrido', standard: 'Estándar' }[n]
      }</button>`
    ).join('');
    L.DomEvent.disableClickPropagation(div);
    L.DomEvent.on(div, 'click', e => {
      const btn = e.target.closest('.layer-btn');
      if (btn && btn.dataset.layer !== current2DLayerName) {
        _switch2DLayer(btn.dataset.layer);
      }
    });
    return div;
  }
});

/* ---- Search box (top-left) ---- */
const SearchControl = L.Control.extend({
  options: { position: 'topleft' },
  onAdd: function () {
    const div = L.DomUtil.create('div', 'leaflet-search-control');
    div.innerHTML = `<input type="text" placeholder="Buscar lugar…" id="search-input">
      <button id="search-btn" title="Buscar">↳</button>`;
    L.DomEvent.disableClickPropagation(div);

    const input = div.querySelector('#search-input');
    const btn = div.querySelector('#search-btn');
    function doSearch() {
      const q = input.value.trim();
      if (!q) return;
      fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&limit=5`)
        .then(r => r.json())
        .then(results => {
          if (results.length > 0) {
            const r = results[0];
            map.setView([r.lat, r.lon], 12);
            input.blur();
          }
        })
        .catch(err => console.error('Search failed:', err));
    }
    L.DomEvent.on(btn, 'click', doSearch);
    L.DomEvent.on(input, 'keydown', e => { if (e.key === 'Enter') doSearch(); });
    return div;
  }
});

window.initMap = function () {
  const container = document.getElementById('viewer-2d');

  map = L.map(container, { center: [40, -100], zoom: 4, zoomControl: true });

  tileLayers.satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { maxZoom: 19, attribution: 'ESRI' }
  );
  tileLayers.standard = L.tileLayer(
    'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    { maxZoom: 19, attribution: 'OpenStreetMap' }
  );

  currentTileLayer = tileLayers.satellite.addTo(map);

  map.addControl(new LayerBar());
  map.addControl(new SearchControl());

  drawnItems = new L.FeatureGroup();
  map.addLayer(drawnItems);

  drawControl = new L.Control.Draw({
    draw: {
      polygon: false, polyline: false, circle: false,
      circlemarker: false, marker: false, rectangle: true,
    },
    edit: { featureGroup: drawnItems, edit: false },
  });
  map.addControl(drawControl);

  map.on(L.Draw.Event.CREATED, onRectangleDrawn);

  if (container.clientWidth > 0 && container.clientHeight > 0) {
    map.invalidateSize();
  } else {
    setTimeout(() => map.invalidateSize(), 200);
  }
};

window.toggleDraw = function () {
  if (!map) return;
  if (map.drawHandler?.enabled()) { map.drawHandler.disable(); return; }
  map.drawHandler = new L.Draw.Rectangle(map);
  map.drawHandler.enable();
};

function onRectangleDrawn(e) {
  if (rectLayer) drawnItems.removeLayer(rectLayer);
  rectLayer = e.layer;
  const bounds = rectLayer.getBounds();
  const sw = bounds.getSouthWest();
  const ne = bounds.getNorthEast();
  appState.bbox = { west: sw.lng, south: sw.lat, east: ne.lng, north: ne.lat };
  document.getElementById("bbox-info").textContent =
    `${ne.lat.toFixed(4)}°N, ${sw.lat.toFixed(4)}°S, ${ne.lng.toFixed(4)}°E, ${sw.lng.toFixed(4)}°W`;
}

window.invalidateSize = function () {
  if (map) setTimeout(() => map.invalidateSize(), 100);
};

window.importGeoJSON = function (file) {
  const reader = new FileReader();
  reader.onload = function (e) {
    try {
      const data = JSON.parse(e.target.result);
      const layer = L.geoJSON(data, {
        style: { color: '#ff6600', weight: 2, fillOpacity: 0.15 },
      }).addTo(map);
      appState.geoJSON = data;
      map.fitBounds(layer.getBounds());
    } catch (err) {
      console.error('Error loading GeoJSON:', err);
      alert('Error al cargar GeoJSON: ' + err.message);
    }
  };
  reader.readAsText(file);
};

window.clearGeoJSON = function () {
  appState.geoJSON = null;
  if (is3D()) {
    geoJson3DObjects.forEach(o => { scene.remove(o); o.geometry?.dispose(); o.material?.dispose(); });
    geoJson3DObjects = [];
  }
};

window.show2DView = function () {
  if (animId) { cancelAnimationFrame(animId); animId = null; }
  document.getElementById('viewer-2d').style.display = 'block';
  document.getElementById('viewer-3d').style.display = 'none';
  document.querySelector('.leaflet-layer-bar')?.style.setProperty('display', '');
  currentView = '2d';
  setTimeout(() => map?.invalidateSize(), 100);
};

window.changeLayer = async function (layer) {
  if (!is3D() || !terrainMesh || !appState.bbox || !THREE) return;

    const btns = document.querySelectorAll('#viewer-3d-controls button');
    btns.forEach(b => b.style.background = '#333');
    const idx = { satellite: 1, standard: 2, hybrid: 3 }[layer] || 1;
    if (btns[idx]) btns[idx].style.background = '#555';

    try {
      const texUrl = await loadMapTexture(appState.bbox, layer, 20000);
      new THREE.TextureLoader().load(texUrl, tex => {
        if (terrainMesh?.material) {
          terrainMesh.material.map = tex;
          terrainMesh.material.needsUpdate = true;
        }
      });
    } catch (err) {
      console.warn('Texture change failed:', err);
    }
  };

async function loadMapTexture(bbox, layer, timeoutMs = 20000) {
  const { north, south, east, west } = bbox;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(
      `/api/map-image?north=${north}&south=${south}&east=${east}&west=${west}&layer=${layer}&size=1024`,
      { signal: ctrl.signal }
    );
    if (!resp.ok) throw new Error(`Map image fetch failed: ${resp.statusText}`);
    const blob = await resp.blob();
    return URL.createObjectURL(blob);
  } finally {
    clearTimeout(timer);
  }
}

/* ---- 3D DEM viewer ---- */
window.show3DView = async function () {
  if (!appState.bbox || !appState.dem) return;

  try { await _loadThree(); } catch (e) {
    console.error('Failed to load Three.js:', e);
    return;
  }

  document.getElementById('viewer-2d').style.display = 'none';
  const container = document.getElementById('viewer-3d');
  container.style.display = 'block';
  document.querySelector('.leaflet-layer-bar')?.style.setProperty('display', 'none');
  currentView = '3d';

  container.style.width = '100%';
  container.style.height = '100%';
  const w = container.clientWidth || 800;
  const h = container.clientHeight || 600;
  console.log('3D container size:', w, h);

  if (scene) {
    try {
      scene.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) { if (obj.material.map) obj.material.map.dispose(); obj.material.dispose(); }
      });
      renderer?.dispose();
      controls?.dispose();
    } catch (_) {}
    northArrow = null;
  }

  try {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x111827);

    camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 1000000);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(w, h);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.querySelector('canvas')?.remove();
    container.insertBefore(renderer.domElement, container.firstChild);

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.1;
    controls.target.set(0, 0, 0);

    scene.add(new THREE.AmbientLight(0x8080a0, 1.0));
    const dirLight = new THREE.DirectionalLight(0xffffff, 1.5);
    dirLight.position.set(1, 1, 0.5);
    scene.add(dirLight);
    const backLight = new THREE.DirectionalLight(0xffffff, 0.6);
    backLight.position.set(-1, -1, 0);
    scene.add(backLight);

    const elevResp = await fetch(
      `/dem/data?north=${appState.bbox.north}&south=${appState.bbox.south}&east=${appState.bbox.east}&west=${appState.bbox.west}&dem_type=${document.getElementById('dem-source').value}`
    );
    if (!elevResp.ok) throw new Error('Failed to fetch DEM data');
    const elevData = await elevResp.json();

    const ncols = elevData.ncols, nrows = elevData.nrows;
    const cellSize = elevData.cellSize;
    const isProjected = !!elevData.is_projected;
    const elevations = new Float32Array(elevData.elevations);
    const maxElev = Math.max(...elevations);
    const minElev = Math.min(...elevations);
    console.log('DEM data:', { ncols, nrows, cellSize, isProjected, maxElev, minElev });

    const lat = (appState.bbox.north + appState.bbox.south) / 2 * Math.PI / 180;
    const mPerDegLon = 111320 * Math.cos(lat);
    const cellW = cellSize * (isProjected ? 1 : mPerDegLon);
    const cellH = cellSize * (isProjected ? 1 : 111320);

    const geo = new THREE.PlaneGeometry(ncols, nrows, ncols - 1, nrows - 1);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position.array;

    const centerX = (ncols - 1) / 2 * cellW;
    const centerZ = (nrows - 1) / 2 * cellH;

    demElevations = elevations;
    demNcols = ncols;
    demNrows = nrows;
    demCellW = cellW;
    demCellH = cellH;
    demCenterX = centerX;
    demCenterZ = centerZ;

    for (let r = 0; r < nrows; r++) {
      for (let c = 0; c < ncols; c++) {
        const i = r * ncols + c;
        const idx = i * 3;
        pos[idx] = c * cellW - centerX;
        pos[idx + 1] = elevations[i];
        pos[idx + 2] = r * cellH - centerZ;
      }
    }
    geo.computeVertexNormals();

    /* ---- Texture (satellite, with fallback) ---- */
    let mat;
    try {
      const texUrl = await loadMapTexture(appState.bbox, 'satellite', 20000);
      const texture = new THREE.TextureLoader().load(texUrl);
      mat = new THREE.MeshStandardMaterial({
        map: texture, side: THREE.DoubleSide,
        roughness: 0.7, metalness: 0.1,
      });
    } catch (e) {
      console.warn('Texture fallback, using solid color:', e);
      mat = new THREE.MeshStandardMaterial({
        color: 0x6b8e6b, side: THREE.DoubleSide,
        roughness: 0.8, metalness: 0.0,
      });
    }

    terrainMesh = new THREE.Mesh(geo, mat);
    scene.add(terrainMesh);

    const maxDim = Math.max(ncols * cellW, nrows * cellH);
    const dist = maxDim * 1.2;
    const elevMid = (minElev + maxElev) / 2;
    camera.position.set(dist * 0.4, dist * 0.5 + elevMid, dist * 0.8);
    controls.target.set(0, elevMid, 0);
    controls.minDistance = Math.min(cellW, cellH) * 2;
    controls.maxDistance = maxDim * 5;
    controls.update();

    _addNorthArrow();

    _startAnim();

    if (appState.geoJSON) _addGeoJSONto3D(appState.geoJSON);
    if (appState.windData && appState.windData.length > 0) {
      _addWindArrows(appState.windData[appState.timeIndex || 0]);
    }
  } catch (err) {
    console.error('Error building 3D scene:', err);
    document.getElementById('status-msg') && setStatus?.('Error al construir vista 3D: ' + err.message, 'error');
  }
};

/* ---- Wind arrows (3D cones) ---- */
function _addWindArrows(geoJson) {
  if (!scene || !THREE) return;
  _clearWindArrows();
  if (!geoJson || !geoJson.features) return;

  const maxSpeed = geoJson.features.reduce((m, f) => Math.max(m, f.properties.speed || 0), 0) || 1;
  const bbox = appState.bbox;
  const lat = (bbox.north + bbox.south) / 2 * Math.PI / 180;
  const mPerDegLon = 111320 * Math.cos(lat);

  geoJson.features.forEach(f => {
    const [lon, lat_] = f.geometry.coordinates;
    const speed = f.properties.speed || 0;
    const dir = f.properties.direction || 0;
    if (speed <= 0) return;

    const u = (lon - bbox.west) / (bbox.east - bbox.west);
    const v = (lat_ - bbox.south) / (bbox.north - bbox.south);
    const x = (u - 0.5) * (bbox.east - bbox.west) * mPerDegLon;
    const z = (v - 0.5) * (bbox.north - bbox.south) * 111320;

    const arrowLen = 200 + (speed / maxSpeed) * 1500;

    const sampleCol = Math.round(((u - 0.5) * (bbox.east - bbox.west) * mPerDegLon + demCenterX) / demCellW);
    const sampleRow = Math.round(((v - 0.5) * (bbox.north - bbox.south) * 111320 + demCenterZ) / demCellH);
    let elev = 200;
    if (demElevations && sampleCol >= 0 && sampleCol < demNcols && sampleRow >= 0 && sampleRow < demNrows) {
      elev = demElevations[sampleRow * demNcols + sampleCol] + 50;
    }

    const rad = (dir + 180) * Math.PI / 180;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(arrowLen * 0.04, arrowLen, 6),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color().setHSL(0.33 - (speed / maxSpeed) * 0.33, 0.8, 0.5),
        roughness: 0.6,
      })
    );
    cone.position.set(x, elev, z);
    cone.rotation.x = Math.PI / 2;
    cone.rotation.order = 'YXZ';
    cone.rotation.y = -rad;
    scene.add(cone);
    windArrows.push(cone);
  });
}

window.addWindArrows = function (geoJson) {
  if (is3D() && THREE) _addWindArrows(geoJson);
};

function _clearWindArrows() {
  windArrows.forEach(o => { scene?.remove(o); o.geometry?.dispose(); o.material?.dispose(); });
  windArrows = [];
}



window.clearWindArrows = function () { if (is3D()) _clearWindArrows(); };

/* ---- North arrow ---- */
function _addNorthArrow() {
  if (!scene || !THREE || !demElevations) return;
  const maxExt = Math.max(demCenterX, demCenterZ);
  const offset = maxExt * 0.85;
  const arrSize = Math.min(demCellW, demCellH) * 20;

  const sc = Math.round((-offset + demCenterX) / demCellW);
  const sr = Math.round((-offset + demCenterZ) / demCellH);
  let elev = 0;
  if (sc >= 0 && sc < demNcols && sr >= 0 && sr < demNrows) {
    elev = demElevations[sr * demNcols + sc] + arrSize * 0.5;
  }

  if (northArrow) { scene.remove(northArrow); northArrow = null; }
  const origin = new THREE.Vector3(-offset, elev, -offset);
  const dir = new THREE.Vector3(0, 0, 1);
  dir.normalize();
  northArrow = new THREE.ArrowHelper(dir, origin, arrSize * 3, 0xff0000, arrSize, arrSize * 0.3);
  scene.add(northArrow);
}

window.onTimeSlider = function (input) {
  const idx = parseInt(input.value);
  appState.timeIndex = idx;
  document.getElementById("time-label").textContent = `Paso ${idx + 1} / ${appState.timeCount}`;
  if (appState.windData && appState.windData.length > idx) {
    _addWindArrows(appState.windData[idx]);
  }
};

/* ---- GeoJSON in 3D ---- */
function _addGeoJSONto3D(geojson) {
  if (!scene || !THREE) return;
  geoJson3DObjects.forEach(o => { scene.remove(o); o.geometry?.dispose(); o.material?.dispose(); });
  geoJson3DObjects = [];
  if (!geojson || !geojson.features) return;

  const bbox = appState.bbox;
  const lat = (bbox.north + bbox.south) / 2 * Math.PI / 180;
  const mPerDegLon = 111320 * Math.cos(lat);

  geojson.features.forEach(f => {
    if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
      const coords = f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates[0];
      const pts = coords[0].map(([lon, lat_]) => {
        const u = (lon - bbox.west) / (bbox.east - bbox.west);
        const v = (lat_ - bbox.south) / (bbox.north - bbox.south);
        return new THREE.Vector3(
          (u - 0.5) * (bbox.east - bbox.west) * mPerDegLon,
          0,
          (v - 0.5) * (bbox.north - bbox.south) * 111320
        );
      });
      const shape = new THREE.ShapeGeometry(pts.map(p => new THREE.Vector2(p.x, p.z)));
      const mesh = new THREE.Mesh(shape, new THREE.MeshBasicMaterial({
        color: 0xff6600, transparent: true, opacity: 0.2, side: THREE.DoubleSide, depthWrite: false,
      }));
      mesh.position.y = 50;
      mesh.rotation.x = -Math.PI / 2;
      scene.add(mesh);
      geoJson3DObjects.push(mesh);

      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([...pts, pts[0]]),
        new THREE.LineBasicMaterial({ color: 0xff6600 })
      );
      line.position.y = 51;
      scene.add(line);
      geoJson3DObjects.push(line);
    }
  });
}

/* ---- Animation loop ---- */
function _startAnim() {
  if (animId) cancelAnimationFrame(animId);
  function animate() {
    animId = requestAnimationFrame(animate);
    controls?.update();
    renderer?.render(scene, camera);
  }
  animate();
}

window.onResize = function () {
  if (is3D() && renderer && camera) {
    const container = document.getElementById('viewer-3d');
    const w = container.clientWidth;
    const h = container.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  }
};

window.addEventListener('resize', () => window.onResize?.());
document.addEventListener('DOMContentLoaded', window.initMap);
