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
};

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
