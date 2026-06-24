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
        await viewer.show3DView();
        await new Promise(r => setTimeout(r, 500));
    }
    const renderer = document.querySelector('#viewer-3d canvas');
    if (!renderer) {
        setStatus('Could not access 3D view. Switch to 3D first.', 'error');
        return;
    }
    const imageData = renderer.toDataURL('image/png');
    const bbox = appState.bbox;
    const windData = appState.windData;
    const timeLabels = appState.timeLabels || [];
    const speeds = windData.flatMap(g => g.features.map(f => f.properties.speed || 0));
    const minSpeed = speeds.length > 0 ? Math.min(...speeds) : 0;
    const maxSpeed = speeds.length > 0 ? Math.max(...speeds) : 0;
    const timeStr = timeLabels.length > 0
        ? timeLabels.join(', ')
        : new Date().toISOString().slice(0, 10);
    const htmlContent = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>WindNinja Presentation</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    background: #1e1e2e;
    color: #cdd6f4;
    font-family: 'Segoe UI', system-ui, sans-serif;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100vh;
    padding: 40px 20px;
  }
  .slide {
    max-width: 1100px;
    width: 100%;
    background: #181825;
    border-radius: 16px;
    padding: 48px 40px 40px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5);
  }
  h1 {
    font-size: 2.2rem;
    font-weight: 600;
    text-align: center;
    margin-bottom: 32px;
    color: #89b4fa;
    letter-spacing: -0.5px;
  }
  .img-container {
    display: flex;
    justify-content: center;
    margin-bottom: 32px;
  }
  .img-container img {
    max-width: 100%;
    height: auto;
    border-radius: 12px;
    border: 1px solid #313244;
    background: #11111b;
  }
  .meta {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px 40px;
  }
  .meta-item {
    display: flex;
    flex-direction: column;
  }
  .meta-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.8px;
    color: #6c7086;
    margin-bottom: 2px;
  }
  .meta-value {
    font-size: 1rem;
    font-weight: 500;
    color: #a6e3a1;
  }
  .meta-value.coords {
    color: #89b4fa;
    font-family: 'JetBrains Mono', 'Cascadia Code', monospace;
    font-size: 0.85rem;
  }
  .footer {
    margin-top: 32px;
    text-align: center;
    font-size: 0.75rem;
    color: #585b70;
    border-top: 1px solid #313244;
    padding-top: 20px;
  }
  @media (max-width: 600px) {
    .slide { padding: 24px 16px; }
    h1 { font-size: 1.5rem; }
    .meta { grid-template-columns: 1fr; gap: 8px; }
  }
</style>
</head>
<body>
<div class="slide">
  <h1>WindNinja Simulation</h1>
  <div class="img-container">
    <img src="${imageData}" alt="Wind simulation 3D view">
  </div>
  <div class="meta">
    <div class="meta-item">
      <span class="meta-label">Bounding Box</span>
      <span class="meta-value coords">N ${bbox.north.toFixed(4)}° · S ${bbox.south.toFixed(4)}°<br>E ${bbox.east.toFixed(4)}° · W ${bbox.west.toFixed(4)}°</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Timestamps</span>
      <span class="meta-value">${timeStr}</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Wind Speed Range</span>
      <span class="meta-value">${(minSpeed * 3.6).toFixed(1)} – ${(maxSpeed * 3.6).toFixed(1)} km/h</span>
    </div>
    <div class="meta-item">
      <span class="meta-label">Simulation Steps</span>
      <span class="meta-value">${windData.length}</span>
    </div>
  </div>
  <div class="footer">Generated by WindNinja Web</div>
</div>
</body>
</html>`;
    const blob = new Blob([htmlContent], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'windninja-presentation.html';
    a.click();
    URL.revokeObjectURL(url);
    setStatus('Presentation downloaded', 'success');
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
