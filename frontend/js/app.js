const API_BASE = window.location.origin;
let appState = {
    dem: null,
    bbox: null,
    tasks: {},
    currentTaskId: null,
    currentType: "single",
    timeIndex: 0,
    timeCount: 0,
    windData: null,
    geoJSON: null,
};
window.appState = appState;

async function apiPost(path, body) {
    const r = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail || r.statusText);
    }
    return r.json();
}

async function apiGet(path) {
    const r = await fetch(`${API_BASE}${path}`);
    if (!r.ok) {
        const err = await r.json().catch(() => ({}));
        throw new Error(err.detail || r.statusText);
    }
    return r.json();
}

document.getElementById('geojson-file-input')?.addEventListener('change', function (e) {
    if (this.files && this.files[0]) {
        window.importGeoJSON(this.files[0]);
    }
});

document.addEventListener('DOMContentLoaded', function () {
    document.getElementById('viewer-geojson-input').style.display = 'block';
});
