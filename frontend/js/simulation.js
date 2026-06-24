import { appState, apiPost, apiGet } from './state.js';
import { getHourlyData } from './sidebar.js';

export function setStatus(msg, type) {
    const el = document.getElementById("status-msg");
    if (!el) return;
    el.textContent = msg;
    el.className = "status-msg " + (type || "info");
    el.style.display = "block";
}

export function clearStatus() {
    const el = document.getElementById("status-msg");
    if (el) el.style.display = "none";
}

export async function fetchDEM() {
    const source = document.getElementById("dem-source").value;
    if (source === "upload") {
        document.getElementById("file-upload-input").click();
        return;
    }
    if (!appState.bbox) return setStatus("Select an area on the map first", "error");
    const btn = document.getElementById("fetch-dem-btn");
    const origText = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span> Downloading…';
    btn.disabled = true;
    setStatus("Downloading DEM…", "info");
    try {
        const resp = await apiPost("/dem/fetch", {
            north: appState.bbox.north,
            south: appState.bbox.south,
            east: appState.bbox.east,
            west: appState.bbox.west,
            dem_type: source,
        });
        appState.dem = resp.path;
        setStatus("DEM ready: " + resp.dem_type.toUpperCase() + " (" + resp.status + ")", "success");
        try {
            const viewer = await import('./viewer.js');
            await viewer.show3DView();
        } catch (err) {
            setStatus("3D view error: " + err.message, "error");
        }
    } catch (e) {
        setStatus("DEM download error: " + e.message, "error");
    } finally {
        btn.innerHTML = origText;
        btn.disabled = false;
    }
}

export async function uploadDEM(file) {
    const form = new FormData();
    form.append("file", file);
    const r = await fetch(`${window.location.origin}/dem/upload`, { method: "POST", body: form });
    const resp = await r.json();
    appState.dem = resp.path;
    alert("DEM uploaded: " + resp.path);
}

function basePayload() {
    if (!appState.bbox) { alert("Select an area on the map first"); return null; }
    const demType = document.getElementById("dem-source").value;
    return {
        dem_source: demType === "upload" && appState.dem ? appState.dem : "auto",
        dem_type: demType === "upload" ? "srtm" : demType,
        north: appState.bbox.north,
        south: appState.bbox.south,
        east: appState.bbox.east,
        west: appState.bbox.west,
        vegetation: document.getElementById("vegetation").value,
        number_cpus: 2,
        input_wind_height: parseFloat(document.getElementById("wind-height").value) || 10,
        output_wind_height: parseFloat(document.getElementById("wind-height").value) || 10,
        mesh_resolution: parseFloat(document.getElementById("mesh-res").value) || 100,
        time_zone: document.getElementById("timezone").value,
    };
}

function showProgress() {
    document.getElementById("progress-bar").style.display = "block";
    document.getElementById("progress-fill").style.width = "0%";
    document.getElementById("export-btn").disabled = true;
    document.getElementById("time-slider-container").style.display = "none";
}

export async function runSimulation() {
    const base = basePayload();
    if (!base) return;
    const hd = getHourlyData();

    showProgress();

    const simBtn = document.getElementById("sim-btn");
    const origText = simBtn.textContent;
    simBtn.innerHTML = '<span class="spinner"></span> Simulating…';
    simBtn.disabled = true;
    setStatus("Starting simulation…", "info");

    const diurnal = document.getElementById("diurnal-toggle").checked;
    const stability = document.getElementById("stability-toggle").checked;
    const dialEnabled = diurnal || stability;

    try {
        if (hd.count === 1) {
            const payload = {
                ...base,
                input_speed: hd.speeds[0],
                input_direction: hd.directions[0],
            };
            if (dialEnabled) addDialParams(payload, hd);
            setStatus("Launching single simulation…", "info");
            const resp = await apiPost("/simulate/", payload);
            appState.currentTaskId = resp.task_id;
            appState.currentType = "single";

            await pollStatus(resp.task_id, async () => {
                setStatus("Loading results…", "info");
                const grid = await apiGet(`/simulate/grid/${resp.task_id}`);
                appState.windData = [grid];
                appState.timeCount = 1;
                const spds = grid.features.map(f => f.properties.speed || 0);
                const mx = spds.length > 0 ? Math.max(...spds) : 0;
                const sorted = [...spds].sort((a, b) => a - b);
                const p50 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.5)] : 0;
                const viewer = await import('./viewer.js');
                viewer.updateColorScale(p50 * 3.6, mx * 3.6);
                viewer.addWindArrows(grid, appState.bbox);
                document.getElementById("export-btn").disabled = false;
                setStatus("Simulation complete", "success");
            });
        } else {
            const payload = {
                ...base,
                speeds: hd.speeds,
                directions: hd.directions,
            };
            if (dialEnabled) addDialParams(payload, hd);
            setStatus("Launching time series (" + hd.count + " steps)…", "info");
            const resp = await apiPost("/simulate/timeseries", payload);
            appState.currentTaskId = resp.task_id;
            appState.currentType = "timeseries";

            await pollStatus(resp.task_id, async () => {
                setStatus("Loading results…", "info");
                const grids = [];
                for (let i = 0; i < hd.count; i++) {
                    const g = await apiGet(`/simulate/grid/${resp.task_id}?index=${i}`);
                    grids.push(g);
                }
                appState.windData = grids;
                appState.timeCount = hd.count;
                appState.timeIndex = 0;
                appState.timeLabels = hd.dates.map((d, i) => {
                    const h = String(hd.hours[i] || 0).padStart(2, '0');
                    return d ? `${d} ${h}:00` : `Hour ${h}:00`;
                });
                const allSpd = grids.flatMap(g => g.features.map(f => f.properties.speed || 0));
                const mx = allSpd.length > 0 ? Math.max(...allSpd) : 0;
                const sorted = [...allSpd].sort((a, b) => a - b);
                const p50 = sorted.length > 0 ? sorted[Math.floor(sorted.length * 0.5)] : 0;
                const viewer = await import('./viewer.js');
                viewer.updateColorScale(p50 * 3.6, mx * 3.6);
                viewer.addWindArrows(grids[0], appState.bbox);
                document.getElementById("time-slider-container").style.display = "block";
                document.getElementById("time-label").textContent = appState.timeLabels[0];
                document.getElementById("time-slider").max = hd.count - 1;
                document.getElementById("time-slider").value = 0;
                document.getElementById("export-btn").disabled = false;
                setStatus("Simulation complete (" + hd.count + " steps)", "success");
            });
        }
    } catch (e) {
        setStatus("Error: " + e.message, "error");
    } finally {
        simBtn.innerHTML = origText;
        simBtn.disabled = false;
    }
}

function addDialParams(payload, hd) {
    payload.air_temp = hd.temps[0];
    payload.cloud_cover = hd.clouds[0];
    const rows = document.querySelectorAll("#hourly-table tbody tr");
    if (rows.length > 0) {
        const r = rows[0];
        const hourVal = parseInt(r.dataset.hour) || 12;
        payload.hour = hourVal;
        if (hd.dates[0]) {
            const d = new Date(hd.dates[0] + "T" + String(hourVal).padStart(2, "0") + ":00");
            payload.year = d.getFullYear();
            payload.month = d.getMonth() + 1;
            payload.day = d.getDate();
        }
    }
}

async function pollStatus(taskId, onComplete) {
    return new Promise((resolve, reject) => {
        const poll = setInterval(async () => {
            try {
                const status = await apiGet(`/simulate/status/${taskId}`);
                const fill = document.getElementById("progress-fill");
                fill.style.width = `${(status.progress || 0) * 100}%`;

                if (status.status === "completed") {
                    clearInterval(poll);
                    document.getElementById("progress-fill").style.width = "100%";
                    await onComplete();
                    resolve();
                } else if (status.status === "failed") {
                    clearInterval(poll);
                    reject(new Error(status.error || "Simulation failed"));
                }
            } catch (e) {
                clearInterval(poll);
                reject(e);
            }
        }, 1500);
    });
}

export async function exportPresentation() {
    if (!appState.bbox || !appState.windData) {
        setStatus('No simulation data available.', 'error');
        return;
    }
    const viewer = await import('./viewer.js');
    const canvas = document.querySelector('#viewer-3d canvas');
    if (!canvas) {
        setStatus('Switching to 3D view...', 'info');
        try {
            await viewer.show3DView();
            await new Promise(r => setTimeout(r, 500));
        } catch (e) {
            setStatus('Could not switch to 3D: ' + e.message, 'error');
            return;
        }
    }
    const demData = viewer.getDemData();
    if (!demData) {
        setStatus('No DEM data loaded. Download a DEM first.', 'error');
        return;
    }
    const elevArr = demData.elevations;
    const meta = { ncols: demData.ncols, nrows: demData.nrows, cellW: demData.cellW, cellH: demData.cellH, centerX: demData.centerX, centerZ: demData.centerZ };
    const bbox = appState.bbox;
    const windData = appState.windData;
    const timeLabels = appState.timeLabels || [];
    const speedsBuckets = viewer.getSpeedBuckets();
    const allSpd = windData.flatMap(g => g.features.map(f => f.properties.speed || 0));
    const maxSpeed = allSpd.length > 0 ? Math.max(...allSpd) : 0;
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WindNinja — Interactive Scenario</title>
<script type="importmap">
{
  "imports": {
    "three": "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js",
    "three/addons/": "https://cdn.jsdelivr.net/npm/three@0.170.0/examples/jsm/"
  }
}
</script>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{background:#11111b;color:#cdd6f4;font-family:'Segoe UI',system-ui,sans-serif;overflow:hidden;width:100vw;height:100vh}
#container{width:100%;height:100%;display:block}
#ui-overlay{position:absolute;bottom:30px;left:50%;transform:translateX(-50%);z-index:10;background:#1e1e2e;border:1px solid #313244;border-radius:12px;padding:12px 20px;display:flex;flex-direction:column;align-items:center;gap:8px;min-width:320px;backdrop-filter:blur(8px)}
#time-label{font-size:0.8rem;color:#a6adc8}
#time-slider{width:100%;accent-color:#89b4fa;cursor:pointer}
.controls{display:flex;gap:8px;align-items:center}
.controls button{background:#45475a;border:none;color:#cdd6f4;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:0.85rem}
.controls button:hover{background:#585b70}
#color-scale{position:absolute;top:20px;right:20px;z-index:10;background:rgba(30,30,46,0.9);border:1px solid #313244;border-radius:8px;padding:8px 12px;display:flex;flex-direction:row;align-items:center;gap:6px;font-size:0.7rem}
#color-scale .bar{width:100px;height:10px;border-radius:4px;background:linear-gradient(90deg,#2196F3,#4CAF50,#FFC107,#FF9800,#F44336)}
#color-scale .labels{display:flex;justify-content:space-between;width:100px;font-size:0.6rem;color:#a6adc8}
#info{position:absolute;bottom:100px;left:50%;transform:translateX(-50%);z-index:10;color:#585b70;font-size:0.7rem;pointer-events:none;text-align:center}
</style>
</head>
<body>
<div id="container"></div>
<div id="info">Drag to rotate · Scroll to zoom</div>
<div id="ui-overlay">
  <div id="time-label">${timeLabels[0] || 'Step 1'}</div>
  <input type="range" id="time-slider" min="0" max="${windData.length - 1}" value="0" style="width:100%">
  <div class="controls">
    <button id="prev-btn">◀ Prev</button>
    <button id="next-btn">Next ▶</button>
  </div>
</div>
<div id="color-scale">
  <span>0</span>
  <div><div class="bar"></div><div class="labels"><span>${Math.round(maxSpeed * 2.7)}</span><span>${Math.round(maxSpeed * 3.6)}</span></div></div>
  <span>km/h</span>
</div>
<script type="module">
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const BUCKETS = ${JSON.stringify(speedsBuckets)};
const ELEV = new Float64Array(${JSON.stringify(elevArr)});
const NCOLS = ${meta.ncols};
const NROWS = ${meta.nrows};
const CELLW = ${meta.cellW};
const CELLH = ${meta.cellH};
const CX = ${meta.centerX};
const CZ = ${meta.centerZ};
const BBOX = ${JSON.stringify(bbox)};
const WIND = ${JSON.stringify(windData)};
const LABELS = ${JSON.stringify(timeLabels)};

const lat = (BBOX.north + BBOX.south) / 2 * Math.PI / 180;
const mPerDegLon = 111320 * Math.cos(lat);

const cont = document.getElementById('container');
const w = cont.clientWidth, h = cont.clientHeight;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x111827);
const camera = new THREE.PerspectiveCamera(55, w/h, 0.1, 1000000);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(w, h);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
cont.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.1;
scene.add(new THREE.AmbientLight(0x8080a0, 1.0));
const dl = new THREE.DirectionalLight(0xffffff, 1.5);
dl.position.set(1,1,0.5);
scene.add(dl);
const bl = new THREE.DirectionalLight(0xffffff, 0.6);
bl.position.set(-1,-1,0);
scene.add(bl);

const geo = new THREE.PlaneGeometry(NCOLS, NROWS, NCOLS-1, NROWS-1);
geo.rotateX(-Math.PI/2);
const pos = geo.attributes.position.array;
for (let r = 0; r < NROWS; r++) {
  for (let c = 0; c < NCOLS; c++) {
    const i = r * NCOLS + c;
    const idx = i * 3;
    pos[idx] = c * CELLW - CX;
    pos[idx+1] = ELEV[i] * 1.5;
    pos[idx+2] = r * CELLH - CZ;
  }
}
geo.computeVertexNormals();
const mat = new THREE.MeshStandardMaterial({ color: 0x6b8e6b, side: THREE.DoubleSide, roughness: 0.8, metalness: 0.0 });
const terrain = new THREE.Mesh(geo, mat);
scene.add(terrain);

const maxDim = Math.max(NCOLS * CELLW, NROWS * CELLH);
const dist = maxDim * 1.2;
camera.position.set(dist*0.4, dist*0.5, dist*0.8);
controls.target.set(0, 0, 0);
controls.minDistance = Math.min(CELLW, CELLH) * 2;
controls.maxDistance = maxDim * 5;
controls.update();

let arrowGroups = [];
let currentStep = 0;

function buildArrows(stepIdx) {
  arrowGroups.forEach(g => { scene.remove(g); g.traverse(c => { if(c.isMesh){c.geometry?.dispose();c.material?.dispose()}}); });
  arrowGroups = [];
  const data = WIND[stepIdx];
  if (!data || !data.features) return;
  data.features.forEach(f => {
    const [lon, lat_] = f.geometry.coordinates;
    const speed = f.properties.speed || 0;
    const dir = f.properties.direction || 0;
    if (speed <= 0) return;
    const speedKmh = speed * 3.6;
    const bucket = BUCKETS.find(b => speedKmh <= b.max) || BUCKETS[BUCKETS.length-1];
    const bboxW = (BBOX.east - BBOX.west) * mPerDegLon;
    const bboxH = (BBOX.north - BBOX.south) * 111320;
    const bboxDiag = Math.sqrt(bboxW*bboxW + bboxH*bboxH);
    const baseSize = bboxDiag * 0.04;
    const smallLen = baseSize * bucket.size;
    const coneR = smallLen * 0.04;
    const u = (lon - BBOX.west) / (BBOX.east - BBOX.west);
    const v = (lat_ - BBOX.south) / (BBOX.north - BBOX.south);
    const x = (u-0.5) * bboxW;
    const z = -(v-0.5) * bboxH;
    const col = Math.round(((u-0.5)*bboxW + CX) / CELLW);
    const row = Math.round((z + CZ) / CELLH);
    let elev = 200;
    if (col >= 0 && col < NCOLS && row >= 0 && row < NROWS) {
      elev = ELEV[row * NCOLS + col] * 1.5 + 20;
    }
    const rad = (dir + 180) * Math.PI / 180;
    const color = new THREE.Color(bucket.color);
    const grp = new THREE.Group();
    const shaftLen = smallLen * 0.6;
    const headLen = smallLen * 0.4;
    const shaftR = coneR * 0.3;
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(shaftR, shaftR, shaftLen, 6), new THREE.MeshBasicMaterial({ color }));
    shaft.position.y = shaftLen / 2;
    grp.add(shaft);
    const head = new THREE.Mesh(new THREE.ConeGeometry(coneR*1.2, headLen, 6), new THREE.MeshBasicMaterial({ color }));
    head.position.y = shaftLen + headLen / 2;
    grp.add(head);
    grp.position.set(x, elev + smallLen*0.3, z);
    const td = new THREE.Vector3(Math.sin(rad), 0, -Math.cos(rad)).normalize();
    grp.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), td);
    scene.add(grp);
    arrowGroups.push(grp);
  });
}

function setStep(idx) {
  currentStep = idx;
  document.getElementById('time-label').textContent = LABELS[idx] || ('Step ' + (idx+1));
  document.getElementById('time-slider').value = idx;
  buildArrows(idx);
}

setStep(0);

document.getElementById('time-slider').addEventListener('input', e => setStep(parseInt(e.target.value)));
document.getElementById('prev-btn').addEventListener('click', () => { setStep(Math.max(0, currentStep-1)); });
document.getElementById('next-btn').addEventListener('click', () => { setStep(Math.min(WIND.length-1, currentStep+1)); });

function anim() {
  requestAnimationFrame(anim);
  controls.update();
  renderer.render(scene, camera);
}
anim();

window.addEventListener('resize', () => {
  const w2 = cont.clientWidth, h2 = cont.clientHeight;
  camera.aspect = w2 / h2;
  camera.updateProjectionMatrix();
  renderer.setSize(w2, h2);
});
</script>
</body>
</html>`;
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'windninja-scenario.html';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Interactive scenario downloaded', 'success');
}

export async function exportResult() {
    if (!appState.currentTaskId) return;
    const fmt = document.getElementById("export-format").value;
    if (fmt === 'presentation') {
        await exportPresentation();
        return;
    }
    const url = `${window.location.origin}/export/${appState.currentTaskId}/${fmt}`;
    window.open(url, "_blank");
}
