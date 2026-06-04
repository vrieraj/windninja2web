const API_BASE = window.location.origin;
let appState = {
    dem: null,
    bbox: null,
    tasks: {},
    currentTaskId: null,
    timeIndex: 0,
};

async function apiPost(path, body) {
    const r = await fetch(`${API_BASE}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    return r.json();
}

async function apiGet(path) {
    const r = await fetch(`${API_BASE}${path}`);
    return r.json();
}
