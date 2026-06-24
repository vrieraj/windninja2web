import { appState, apiGet } from './state.js';
import { setupGeocoder } from './geocoder.js';
import { updateCompass } from './compass.js';

let THREE, OrbitControls;
let map, drawControl, drawnItems, rectLayer;
let currentTileLayer = null;
let current2DLayerName = 'satellite';

let scene, camera, renderer, controls, terrainMesh, animId;
let windArrows = [], geoJson3DObjects = [];
let demElevations, demNcols, demNrows, demCellW, demCellH, demCenterX, demCenterZ;
let rawElevations = null;
let currentView = '2d';

const tileLayers = {};
const SPEED_BUCKETS = [
    { max: 10, color: '#2196F3', size: 0.5 },
    { max: 20, color: '#4CAF50', size: 0.75 },
    { max: 30, color: '#FFC107', size: 1.0 },
    { max: 60, color: '#FF9800', size: 1.3 },
    { max: Infinity, color: '#F44336', size: 1.6 },
];

function is3D() { return currentView === '3d'; }

async function loadThree() {
    if (THREE) return;
    const mod = await import('three');
    THREE = mod;
    const addon = await import('three/addons/controls/OrbitControls.js');
    OrbitControls = addon.OrbitControls;
}

/* ---- 2D Layer switching ---- */
function switch2DLayer(name) {
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
    updateLayerBar(name);
}

function updateLayerBar(name) {
    document.querySelectorAll('.layer-btn').forEach(b => b.classList.toggle('active', b.dataset.layer === name));
}

const LayerBar = L.Control.extend({
    options: { position: 'topright' },
    onAdd: function () {
        const div = L.DomUtil.create('div', 'leaflet-layer-bar');
        div.innerHTML = ['satellite', 'hybrid', 'standard'].map(n =>
            `<button class="layer-btn${n === 'satellite' ? ' active' : ''}" data-layer="${n}">${
                { satellite: 'Satellite', hybrid: 'Hybrid', standard: 'Standard' }[n]
            }</button>`
        ).join('');
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.on(div, 'click', e => {
            const btn = e.target.closest('.layer-btn');
            if (btn && btn.dataset.layer !== current2DLayerName) {
                switch2DLayer(btn.dataset.layer);
            }
        });
        return div;
    }
});

export function initMap() {
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
    setupGeocoder(map);
    map.addControl(new LayerBar());

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
}

export function toggleDraw() {
    if (!map) return;
    if (map.drawHandler?.enabled()) { map.drawHandler.disable(); return; }
    map.drawHandler = new L.Draw.Rectangle(map);
    map.drawHandler.enable();
}

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

export function importGeoJSON(file) {
    const reader = new FileReader();
    reader.onload = function (e) {
        try {
            const data = JSON.parse(e.target.result);
            const layer = L.geoJSON(data, {
                style: { color: '#ff6600', weight: 2, fillOpacity: 0.15 },
            }).addTo(map);
            appState.geoJSON = data;
            map.fitBounds(layer.getBounds());
            if (is3D()) addGeoJSONto3D(data);
        } catch (err) {
            console.error('Error loading GeoJSON:', err);
            alert('Error loading GeoJSON: ' + err.message);
        }
    };
    reader.readAsText(file);
}

export function clearGeoJSON() {
    appState.geoJSON = null;
    if (is3D()) {
        geoJson3DObjects.forEach(o => { scene.remove(o); o.geometry?.dispose(); o.material?.dispose(); });
        geoJson3DObjects = [];
    }
}

export function show2DView() {
    if (animId) { cancelAnimationFrame(animId); animId = null; }
    document.getElementById('viewer-2d').style.display = 'block';
    document.getElementById('viewer-3d').style.display = 'none';
    document.querySelector('.leaflet-layer-bar')?.style.setProperty('display', '');
    currentView = '2d';
    setTimeout(() => map?.invalidateSize(), 100);
}

export async function changeLayer(layer) {
    if (!is3D() || !terrainMesh || !appState.bbox || !THREE) return;

    const btns = document.querySelectorAll('#viewer-3d-controls button');
    btns.forEach(b => b.style.background = '#333');
    const idx = { satellite: 1, standard: 2, hybrid: 3 }[layer] || 1;
    if (btns[idx]) btns[idx].style.background = '#555';

    try {
        const sim = await import('./simulation.js');
        sim.setStatus('Loading texture...', 'info');
        const texUrl = await loadMapTexture(appState.bbox, layer);
        const texture = await new THREE.TextureLoader().loadAsync(texUrl);
        if (terrainMesh?.material) {
            terrainMesh.material.map = texture;
            terrainMesh.material.needsUpdate = true;
        }
    } catch (err) {
        console.warn('Texture change failed:', err);
        const sim = await import('./simulation.js');
        sim.setStatus('Texture change failed: ' + err.message, 'error');
    }
}

async function loadMapTexture(bbox, layer, timeoutMs = 40000) {
    const { north, south, east, west } = bbox;
    for (let attempt = 0; attempt < 2; attempt++) {
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
        } catch (err) {
            clearTimeout(timer);
            if (attempt === 1) throw err;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
}

/* ---- 3D DEM viewer ---- */
export async function show3DView() {
    if (!appState.bbox || !appState.dem) return;
    try { await loadThree(); } catch (e) {
        console.error('Failed to load Three.js:', e);
        return;
    }

    document.getElementById('viewer-2d').style.display = 'none';
    const container = document.getElementById('viewer-3d');
    container.style.display = 'block';
    document.querySelector('.leaflet-layer-bar')?.style.setProperty('display', 'none');
    currentView = '3d';
    document.getElementById('color-scale').style.display = 'none';

    container.style.width = '100%';
    container.style.height = '100%';
    const w = container.clientWidth || 800;
    const h = container.clientHeight || 600;

    if (scene) {
        try {
            scene.traverse(obj => {
                if (obj.geometry) obj.geometry.dispose();
                if (obj.material) { if (obj.material.map) obj.material.map.dispose(); obj.material.dispose(); }
            });
            renderer?.dispose();
            controls?.dispose();
        } catch (_) { }
    }

    try {
        scene = new THREE.Scene();
        scene.background = new THREE.Color(0x111827);

        camera = new THREE.PerspectiveCamera(55, w / h, 0.1, 1000000);
        renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
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

        const demType = document.getElementById('dem-source').value;
        const dataUrl = `/dem/data?north=${appState.bbox.north}&south=${appState.bbox.south}&east=${appState.bbox.east}&west=${appState.bbox.west}&dem_type=${demType}`;
        const elevResp = await fetch(dataUrl);
        if (!elevResp.ok) {
            let detail = '';
            try { const e = await elevResp.json(); detail = e.detail || ''; } catch (_) {}
            throw new Error(`Failed to fetch DEM data: HTTP ${elevResp.status}${detail ? ' — ' + detail : ''}`);
        }
        const elevData = await elevResp.json();

        const ncols = elevData.ncols, nrows = elevData.nrows;
        const cellSize = elevData.cellSize;
        const isProjected = !!elevData.is_projected;
        const elevations = new Float32Array(elevData.elevations);
        rawElevations = new Float32Array(elevations);
        const maxElev = Math.max(...elevations);
        const minElev = Math.min(...elevations);

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

        const exag = parseFloat(document.getElementById('exaggeration-slider')?.value || 1.5);
        for (let r = 0; r < nrows; r++) {
            for (let c = 0; c < ncols; c++) {
                const i = r * ncols + c;
                const idx = i * 3;
                pos[idx] = c * cellW - centerX;
                pos[idx + 1] = elevations[i] * exag;
                pos[idx + 2] = r * cellH - centerZ;
            }
        }
        geo.computeVertexNormals();

        let mat;
        try {
            const sim = await import('./simulation.js');
            sim.setStatus('Loading satellite texture...', 'info');
            const texUrl = await loadMapTexture(appState.bbox, 'satellite');
            const texture = await new THREE.TextureLoader().loadAsync(texUrl);
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

        startAnim();

        try { if (appState.geoJSON) addGeoJSONto3D(appState.geoJSON); } catch (e) { console.warn('GeoJSON 3D failed:', e); }
        try { if (appState.windData && appState.windData.length > 0) addWindArrows(appState.windData[appState.timeIndex || 0], appState.bbox); } catch (e) { console.warn('Wind arrows 3D failed:', e); }
    } catch (err) {
        console.error('Error building 3D scene:', err);
        const sim = await import('./simulation.js');
        sim.setStatus('Error building 3D view: ' + err.message, 'error');
    }
}

/* ---- Wind arrows (3D cones) ---- */
function addWindArrows(geoJson, bbox) {
    if (!scene || !THREE) return;
    clearWindArrows();
    if (!geoJson || !geoJson.features) return;

    bbox = bbox || appState.bbox;
    if (!bbox) {
        console.warn('addWindArrows: bbox is null, skipping');
        return;
    }
    const lat = (bbox.north + bbox.south) / 2 * Math.PI / 180;
    const mPerDegLon = 111320 * Math.cos(lat);

    const exag = parseFloat(document.getElementById('exaggeration-slider')?.value || 1.5);
    geoJson.features.forEach(f => {
        const [lon, lat_] = f.geometry.coordinates;
        const speed = f.properties.speed || 0;
        const dir = f.properties.direction || 0;
        if (speed <= 0) return;

        const speed_k = speed * 3.6;
        const bucket = SPEED_BUCKETS.find(b => speed_k <= b.max) || SPEED_BUCKETS[SPEED_BUCKETS.length - 1];
        const bboxW = (bbox.east - bbox.west) * mPerDegLon;
        const bboxH = (bbox.north - bbox.south) * 111320;
        const bboxDiag = Math.sqrt(bboxW * bboxW + bboxH * bboxH);
        const baseSize = bboxDiag * 0.04;
        const smallLen = baseSize * bucket.size;
        const coneR = smallLen * 0.04;

        const u = (lon - bbox.west) / (bbox.east - bbox.west);
        const v = (lat_ - bbox.south) / (bbox.north - bbox.south);
        const x = (u - 0.5) * (bbox.east - bbox.west) * mPerDegLon;
        const z = -(v - 0.5) * (bbox.north - bbox.south) * 111320;

        const sampleCol = Math.round(((u - 0.5) * (bbox.east - bbox.west) * mPerDegLon + demCenterX) / demCellW);
        const sampleRow = Math.round((z + demCenterZ) / demCellH);
        let elev = 200;
        if (demElevations && sampleCol >= 0 && sampleCol < demNcols && sampleRow >= 0 && sampleRow < demNrows) {
            elev = demElevations[sampleRow * demNcols + sampleCol] * exag + 20;
        }

        const rad = (dir + 180) * Math.PI / 180;
        const arrowColor = new THREE.Color(bucket.color);

        const group = new THREE.Group();
        const shaftLen = smallLen * 0.6;
        const headLen = smallLen * 0.4;
        const shaftR = coneR * 0.3;
        const shaft = new THREE.Mesh(
            new THREE.CylinderGeometry(shaftR, shaftR, shaftLen, 6),
            new THREE.MeshBasicMaterial({ color: arrowColor })
        );
        shaft.position.y = shaftLen / 2;
        group.add(shaft);
        const head = new THREE.Mesh(
            new THREE.ConeGeometry(coneR * 1.2, headLen, 6),
            new THREE.MeshBasicMaterial({ color: arrowColor })
        );
        head.position.y = shaftLen + headLen / 2;
        group.add(head);
        group.position.set(x, elev + smallLen * 0.3, z);
        const targetDir = new THREE.Vector3(Math.sin(rad), 0, -Math.cos(rad)).normalize();
        group.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), targetDir);
        scene.add(group);
        windArrows.push(group);
    });
}

export { addWindArrows };

function _clearWindArrows() {
    windArrows.forEach(o => {
        scene?.remove(o);
        o.traverse(child => {
            if (child.isMesh) { child.geometry?.dispose(); child.material?.dispose(); }
        });
    });
    windArrows = [];
}
export function clearWindArrows() { if (is3D()) _clearWindArrows(); }

/* ---- Terrain exaggeration ---- */
export function setTerrainExaggeration(factor) {
    factor = parseFloat(factor) || 1.5;
    document.getElementById('exaggeration-value').textContent = factor.toFixed(1) + 'x';
    if (!terrainMesh || !rawElevations) return;
    const pos = terrainMesh.geometry.attributes.position.array;
    for (let r = 0; r < demNrows; r++) {
        for (let c = 0; c < demNcols; c++) {
            const i = r * demNcols + c;
            pos[i * 3 + 1] = rawElevations[i] * factor;
        }
    }
    terrainMesh.geometry.attributes.position.needsUpdate = true;
    terrainMesh.geometry.computeVertexNormals();
    if (appState.windData && appState.windData.length > 0) {
        addWindArrows(appState.windData[appState.timeIndex || 0], appState.bbox);
    }
    if (appState.geoJSON) addGeoJSONto3D(appState.geoJSON);
}

/* ---- Color scale ---- */
export function updateColorScale(medianKmh, maxKmh) {
    document.getElementById('color-scale').style.display = '';
    ['cs-1', 'cs-2', 'cs-3', 'cs-4', 'cs-5'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.style.display = '';
    });
    const cs5 = document.getElementById('cs-5');
    if (cs5 && maxKmh > 0) cs5.textContent = '>' + Math.round(maxKmh) + ' km/h';
    const cs4 = document.getElementById('cs-4');
    if (cs4 && maxKmh > 0) cs4.textContent = Math.round(maxKmh * 0.75) + ' km/h';
    const cs3 = document.getElementById('cs-3');
    if (cs3 && medianKmh > 0) cs3.textContent = Math.round(medianKmh) + ' km/h';
    const cs2 = document.getElementById('cs-2');
    if (cs2 && medianKmh > 0) cs2.textContent = Math.round(medianKmh * 0.5) + ' km/h';
}

export function onTimeSlider(input) {
    const idx = parseInt(input.value);
    appState.timeIndex = idx;
    const label = appState.timeLabels && appState.timeLabels[idx]
        ? appState.timeLabels[idx] : `Step ${idx + 1} / ${appState.timeCount}`;
    document.getElementById("time-label").textContent = label;
    if (appState.windData && appState.windData.length > idx) {
        addWindArrows(appState.windData[idx], appState.bbox);
    }
}

export function stepTime(delta) {
    const slider = document.getElementById('time-slider');
    if (!slider) return;
    const newVal = Math.max(0, Math.min(parseInt(slider.max), parseInt(slider.value) + delta));
    slider.value = newVal;
    onTimeSlider(slider);
}

/* ---- GeoJSON in 3D ---- */
function addGeoJSONto3D(geojson) {
    if (!scene || !THREE) return;
    geoJson3DObjects.forEach(o => { scene.remove(o); o.geometry?.dispose(); o.material?.dispose(); });
    geoJson3DObjects = [];
    if (!geojson || !geojson.features) return;

    const bbox = appState.bbox;
    const lat = (bbox.north + bbox.south) / 2 * Math.PI / 180;
    const mPerDegLon = 111320 * Math.cos(lat);

    const exag = parseFloat(document.getElementById('exaggeration-slider')?.value || 1.5);
    geojson.features.forEach(f => {
        if (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon') {
            const coords = f.geometry.type === 'Polygon' ? f.geometry.coordinates : f.geometry.coordinates[0];
            const pts = coords[0].map(([lon, lat_]) => {
                const u = (lon - bbox.west) / (bbox.east - bbox.west);
                const v = (lat_ - bbox.south) / (bbox.north - bbox.south);
                const z = -(v - 0.5) * (bbox.north - bbox.south) * 111320;
                const x = (u - 0.5) * (bbox.east - bbox.west) * mPerDegLon;
                let elev = 0;
                if (demElevations) {
                    const sc = Math.round(u * (demNcols - 1));
                    const sr = Math.round((1 - v) * (demNrows - 1));
                    if (sc >= 0 && sc < demNcols && sr >= 0 && sr < demNrows) {
                        elev = demElevations[sr * demNcols + sc] * exag;
                    }
                }
                return { x, y: elev, z };
            });
            if (pts.length < 3) return;

            const outlinePts = pts.map(p => new THREE.Vector3(p.x, p.y + 100, p.z));
            outlinePts.push(outlinePts[0]);
            const line = new THREE.Line(
                new THREE.BufferGeometry().setFromPoints(outlinePts),
                new THREE.LineBasicMaterial({ color: 0xff6600 })
            );
            scene.add(line);
            geoJson3DObjects.push(line);
        }
    });
}

/* ---- Animation loop ---- */
function startAnim() {
    if (animId) cancelAnimationFrame(animId);
    function animate() {
        animId = requestAnimationFrame(animate);
        controls?.update();
        updateCompass(camera, controls.target);
        renderer?.render(scene, camera);
    }
    animate();
}

export function onResize() {
    if (is3D() && renderer && camera) {
        const container = document.getElementById('viewer-3d');
        const w = container.clientWidth;
        const h = container.clientHeight;
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        renderer.setSize(w, h);
    }
}

window.addEventListener('resize', () => onResize?.());
