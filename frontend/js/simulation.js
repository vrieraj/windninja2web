import { appState, apiPost, apiGet } from './state.js';

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

function getHourlyData() {
    const rows = document.querySelectorAll("#hourly-table tbody tr");
    const speeds = [], directions = [], dates = [], clouds = [], temps = [], hours = [];
    rows.forEach((r) => {
        const inputs = r.querySelectorAll("input");
        speeds.push(parseFloat(inputs[1].value) || 0);
        directions.push(parseFloat(inputs[2].value) || 0);
        dates.push(inputs[3].value || "");
        clouds.push(parseInt(inputs[4].value) || 0);
        temps.push(parseFloat(inputs[5].value) || 0);
        hours.push(parseInt(r.dataset.hour) || 0);
    });
    return { speeds, directions, dates, clouds, temps, hours, count: speeds.length };
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
                const mx = Math.max(...spds);
                const sorted = [...spds].sort((a, b) => a - b);
                const p50 = sorted[Math.floor(sorted.length * 0.5)];
                const viewer = await import('./viewer.js');
                viewer.updateColorScale(p50 * 3.6, mx * 3.6);
                viewer.addWindArrows(grid, 0);
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
                const mx = Math.max(...allSpd);
                const sorted = [...allSpd].sort((a, b) => a - b);
                const p50 = sorted[Math.floor(sorted.length * 0.5)];
                const viewer = await import('./viewer.js');
                viewer.updateColorScale(p50 * 3.6, mx * 3.6);
                viewer.addWindArrows(grids[0], 0);
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

export async function exportResult() {
    if (!appState.currentTaskId) return;
    const fmt = document.getElementById("export-format").value;
    const url = `${window.location.origin}/export/${appState.currentTaskId}/${fmt}`;
    window.open(url, "_blank");
}
