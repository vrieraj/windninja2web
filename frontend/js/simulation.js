async function fetchDEM() {
    if (!appState.bbox) return alert("Selecciona un área en el mapa primero");
    const source = document.getElementById("dem-source").value;
    const resp = await apiPost("/dem/fetch", {
        source,
        north: appState.bbox.north,
        south: appState.bbox.south,
        east: appState.bbox.east,
        west: appState.bbox.west,
    });
    appState.dem = resp;
    alert("DEM descargado exitosamente");
}

async function runSimulation() {
    if (!appState.dem) return alert("Descarga o sube un DEM primero");
    const payload = {
        dem_source: appState.dem.id,
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

    const diurnal = document.getElementById("diurnal-toggle").checked;
    if (diurnal) {
        payload.diurnal_winds = true;
        payload.air_temp = parseFloat(document.getElementById("air-temp").value);
        payload.cloud_cover = parseFloat(document.getElementById("cloud-cover").value) / 100;
        const dt = document.getElementById("sim-datetime").value;
        if (dt) payload.datetime = dt;
    }

    document.getElementById("progress-bar").style.display = "block";
    document.getElementById("export-btn").disabled = true;

    const resp = await apiPost("/simulate/", payload);
    appState.currentTaskId = resp.task_id;

    const poll = setInterval(async () => {
        const status = await apiGet(`/simulate/status/${resp.task_id}`);
        const fill = document.getElementById("progress-fill");
        fill.style.width = `${status.progress * 100}%`;
        if (status.status === "completed") {
            clearInterval(poll);
            appState.tasks[resp.task_id] = status;
            document.getElementById("export-btn").disabled = false;
            alert("Simulación completada");
        } else if (status.status === "failed") {
            clearInterval(poll);
            alert("Error en la simulación");
        }
    }, 1000);
}

async function exportResult() {
    if (!appState.currentTaskId) return;
    const fmt = document.getElementById("export-format").value;
    const url = `${API_BASE}/export/${appState.currentTaskId}/${fmt}`;
    window.open(url, "_blank");
}
