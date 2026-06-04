async function fetchDEM() {
    const source = document.getElementById("dem-source").value;
    if (source === "upload") {
        document.getElementById("file-upload-input").click();
        return;
    }
    if (!appState.bbox) return alert("Selecciona un área en el mapa primero");
    try {
        const resp = await apiPost("/dem/fetch", {
            north: appState.bbox.north,
            south: appState.bbox.south,
            east: appState.bbox.east,
            west: appState.bbox.west,
            dem_type: source,
        });
        appState.dem = resp.path;
        alert("DEM listo: " + resp.dem_type.toUpperCase() + " (" + resp.status + ")");
    } catch (e) {
        alert("Error al descargar DEM: " + e.message);
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

async function runSimulation() {
    if (!appState.bbox) return alert("Selecciona un área en el mapa primero");
    const demType = document.getElementById("dem-source").value;
    const payload = {
        dem_source: demType === "upload" && appState.dem ? appState.dem : "auto",
        dem_type: demType === "upload" ? "srtm" : demType,
        north: appState.bbox.north,
        south: appState.bbox.south,
        east: appState.bbox.east,
        west: appState.bbox.west,
        input_speed: parseFloat(document.getElementById("wind-speed").value),
        input_direction: parseFloat(document.getElementById("wind-dir").value),
        input_wind_height: parseFloat(document.getElementById("wind-height").value),
        vegetation: document.getElementById("vegetation").value,
        mesh_resolution: parseFloat(document.getElementById("mesh-res").value),
        number_cpus: 2,
    };

    document.getElementById("progress-bar").style.display = "block";
    document.getElementById("progress-fill").style.width = "0%";
    document.getElementById("export-btn").disabled = true;
    document.getElementById("time-slider-container").style.display = "none";

    try {
        const resp = await apiPost("/simulate/", payload);
        appState.currentTaskId = resp.task_id;
        appState.currentType = "single";

        await pollStatus(resp.task_id, async () => {
            const grid = await apiGet(`/simulate/grid/${resp.task_id}`);
            appState.windData = [grid];
            appState.timeCount = 1;
            addWindArrows(grid, 0);
            document.getElementById("export-btn").disabled = false;
        });
    } catch (e) {
        alert("Error: " + e.message);
    }
}

async function runTimeSeries() {
    if (!appState.bbox) return alert("Selecciona un área en el mapa primero");
    const demType = document.getElementById("dem-source").value;
    const count = parseInt(document.getElementById("ts-count").value) || 5;
    const baseSpeed = parseFloat(document.getElementById("wind-speed").value) || 5;
    const baseDir = parseFloat(document.getElementById("wind-dir").value) || 270;

    const speeds = [];
    const directions = [];
    for (let i = 0; i < count; i++) {
        speeds.push(+(baseSpeed + Math.sin(i / count * Math.PI * 2) * 3).toFixed(2));
        directions.push(+(baseDir + Math.cos(i / count * Math.PI * 2) * 30).toFixed(1));
    }

    const payload = {
        dem_source: demType === "upload" && appState.dem ? appState.dem : "auto",
        dem_type: demType === "upload" ? "srtm" : demType,
        north: appState.bbox.north,
        south: appState.bbox.south,
        east: appState.bbox.east,
        west: appState.bbox.west,
        speeds,
        directions,
        vegetation: document.getElementById("vegetation").value,
        number_cpus: 2,
    };

    document.getElementById("progress-bar").style.display = "block";
    document.getElementById("progress-fill").style.width = "0%";
    document.getElementById("export-btn").disabled = true;
    document.getElementById("time-slider-container").style.display = "none";

    try {
        const resp = await apiPost("/simulate/timeseries", payload);
        appState.currentTaskId = resp.task_id;
        appState.currentType = "timeseries";

        await pollStatus(resp.task_id, async () => {
            const grids = [];
            for (let i = 0; i < count; i++) {
                const g = await apiGet(`/simulate/grid/${resp.task_id}?index=${i}`);
                grids.push(g);
            }
            appState.windData = grids;
            appState.timeCount = count;
            appState.timeIndex = 0;
            addWindArrows(grids[0], 0);
            document.getElementById("time-slider-container").style.display = "block";
            document.getElementById("time-label").textContent = `Paso 1 / ${count}`;
            document.getElementById("time-slider").max = count - 1;
            document.getElementById("time-slider").value = 0;
            document.getElementById("export-btn").disabled = false;
        });
    } catch (e) {
        alert("Error: " + e.message);
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
