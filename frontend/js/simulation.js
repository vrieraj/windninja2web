function setStatus(msg, type) {
    const el = document.getElementById("status-msg");
    if (!el) return;
    el.textContent = msg;
    el.className = "status-msg " + (type || "info");
    el.style.display = "block";
}

function clearStatus() {
    const el = document.getElementById("status-msg");
    if (el) el.style.display = "none";
}

async function fetchDEM() {
    const source = document.getElementById("dem-source").value;
    if (source === "upload") {
        document.getElementById("file-upload-input").click();
        return;
    }
    if (!appState.bbox) return setStatus("Selecciona un área en el mapa primero", "error");
    const btn = document.getElementById("fetch-dem-btn");
    const origText = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span> Descargando…';
    btn.disabled = true;
    setStatus("Descargando DEM…", "info");
    try {
        const resp = await apiPost("/dem/fetch", {
            north: appState.bbox.north,
            south: appState.bbox.south,
            east: appState.bbox.east,
            west: appState.bbox.west,
            dem_type: source,
        });
        appState.dem = resp.path;
        setStatus("DEM listo: " + resp.dem_type.toUpperCase() + " (" + resp.status + ")", "success");
        try {
            await window.show3DView();
        } catch (err) {
            setStatus("Error en vista 3D: " + err.message, "error");
        }
    } catch (e) {
        setStatus("Error al descargar DEM: " + e.message, "error");
    } finally {
        btn.innerHTML = origText;
        btn.disabled = false;
    }
}

async function uploadDEM(file) {
    const form = new FormData();
    form.append("file", file);
    const r = await fetch(`${API_BASE}/dem/upload`, { method: "POST", body: form });
    const resp = await r.json();
    appState.dem = resp.path;
    alert("DEM subido: " + resp.path);
}

function _basePayload() {
    if (!appState.bbox) { alert("Selecciona un área en el mapa primero"); return null; }
    const demType = document.getElementById("dem-source").value;
    const p = {
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
    };
    if (document.getElementById("diurnal-toggle").checked) {
        p.diurnal_winds = true;
    }
    if (document.getElementById("stability-toggle").checked) {
        p.non_neutral_stability = true;
    }
    p.time_zone = document.getElementById("timezone").value;
    return p;
}

function _showProgress() {
    document.getElementById("progress-bar").style.display = "block";
    document.getElementById("progress-fill").style.width = "0%";
    document.getElementById("export-btn").disabled = true;
    document.getElementById("time-slider-container").style.display = "none";

    if (window.currentView !== '3d' && appState.bbox && appState.dem) {
        window.show3DView();
    }
}

async function runSimulation() {
    const base = _basePayload();
    if (!base) return;
    const hd = getHourlyData();

    _showProgress();

    const simBtn = document.getElementById("sim-btn");
    const origText = simBtn.textContent;
    simBtn.innerHTML = '<span class="spinner"></span> Simulando…';
    simBtn.disabled = true;
    setStatus("Iniciando simulación…", "info");

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
            if (dialEnabled) {
                payload.air_temp = hd.temps[0];
                payload.cloud_cover = hd.clouds[0];
                const hourVal = parseInt(document.querySelector("#hourly-table tbody tr").dataset.hour) || 12;
                payload.hour = hourVal;
                if (hd.dates[0]) {
                    const d = new Date(hd.dates[0] + "T" + String(hourVal).padStart(2, "0") + ":00");
                    payload.year = d.getFullYear();
                    payload.month = d.getMonth() + 1;
                    payload.day = d.getDate();
                }
            }
            setStatus("Lanzando simulación simple…", "info");
            const resp = await apiPost("/simulate/", payload);
            appState.currentTaskId = resp.task_id;
            appState.currentType = "single";

            await pollStatus(resp.task_id, async () => {
                setStatus("Cargando resultados…", "info");
                const grid = await apiGet(`/simulate/grid/${resp.task_id}`);
                appState.windData = [grid];
                appState.timeCount = 1;
                const spds = grid.features.map(f => f.properties.speed || 0);
                const mx = Math.max(...spds);
                const sorted = [...spds].sort((a, b) => a - b);
                const p50 = sorted[Math.floor(sorted.length * 0.5)];
                window.updateColorScale(p50 * 3.6, mx * 3.6);
                window.addWindArrows(grid, 0);
                document.getElementById("export-btn").disabled = false;
                setStatus("Simulación completada", "success");
            });
        } else {
            const payload = {
                ...base,
                speeds: hd.speeds,
                directions: hd.directions,
            };
            if (dialEnabled) {
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
            setStatus("Lanzando serie temporal (" + hd.count + " pasos)…", "info");
            const resp = await apiPost("/simulate/timeseries", payload);
            appState.currentTaskId = resp.task_id;
            appState.currentType = "timeseries";

            await pollStatus(resp.task_id, async () => {
                setStatus("Cargando resultados…", "info");
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
                    return d ? `${d} ${h}:00` : `Hora ${h}:00`;
                });
                const allSpd = grids.flatMap(g => g.features.map(f => f.properties.speed || 0));
                const mx = Math.max(...allSpd);
                const sorted = [...allSpd].sort((a, b) => a - b);
                const p50 = sorted[Math.floor(sorted.length * 0.5)];
                window.updateColorScale(p50 * 3.6, mx * 3.6);
                window.addWindArrows(grids[0], 0);
                document.getElementById("time-slider-container").style.display = "block";
                document.getElementById("time-label").textContent = appState.timeLabels[0];
                document.getElementById("time-slider").max = hd.count - 1;
                document.getElementById("time-slider").value = 0;
                document.getElementById("export-btn").disabled = false;
                setStatus("Simulación completada (" + hd.count + " pasos)", "success");
            });
        }
    } catch (e) {
        setStatus("Error: " + e.message, "error");
    } finally {
        simBtn.innerHTML = origText;
        simBtn.disabled = false;
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
                    reject(new Error(status.error || "Simulación falló"));
                }
            } catch (e) {
                clearInterval(poll);
                reject(e);
            }
        }, 1500);
    });
}

async function exportResult() {
    if (!appState.currentTaskId) return;
    const fmt = document.getElementById("export-format").value;
    const url = `${API_BASE}/export/${appState.currentTaskId}/${fmt}`;
    window.open(url, "_blank");
}
