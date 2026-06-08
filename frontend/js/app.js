import { appState, apiPost, apiGet } from './state.js';
import { initMap, toggleDraw, show2DView, changeLayer, setTerrainExaggeration, updateColorScale, onTimeSlider, stepTime, importGeoJSON, clearGeoJSON, addWindArrows, clearWindArrows } from './viewer.js';
import { buildSidebar, toggleMeteoMode, fetchMeteo, addHourRow, removeHourRow, toggleDiurnal, toggleStability } from './sidebar.js';
import { fetchDEM, uploadDEM, runSimulation, exportResult, setStatus } from './simulation.js';

export { appState, apiPost, apiGet };
export { setStatus, runSimulation, exportResult, fetchDEM, uploadDEM };

/* ---- GeoJSON file input ---- */
document.getElementById('geojson-file-input')?.addEventListener('change', function (e) {
    if (this.files && this.files[0]) {
        importGeoJSON(this.files[0]);
    }
});

/* ---- DEM file upload input ---- */
document.getElementById('file-upload-input')?.addEventListener('change', function (e) {
    if (this.files && this.files[0]) {
        uploadDEM(this.files[0]);
    }
});

/* ---- Data-action event delegation ---- */
document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (typeof actionMap[action] === 'function') {
        actionMap[action](el);
    }
});

document.addEventListener('input', e => {
    const el = e.target.closest('[data-event="input"][data-action]');
    if (!el) return;
    const action = el.dataset.action;
    if (typeof inputMap[action] === 'function') {
        inputMap[action](el);
    }
});

document.addEventListener('change', e => {
    const el = e.target;
    if (!el.dataset?.action) return;
    const action = el.dataset.action;
    if (typeof actionMap[action] === 'function') {
        actionMap[action](el);
    }
});

/* ---- Action handlers ---- */
const actionMap = {
    toggleDraw() { toggleDraw(); },
    fetchDEM() { fetchDEM(); },
    uploadDEM() {
        document.getElementById('file-upload-input').click();
    },
    importGeoJSON() {
        document.getElementById('geojson-file-input').click();
    },
    clearGeoJSON() { clearGeoJSON(); },
    toggleMeteoMode() { toggleMeteoMode(); },
    fetchMeteo() { fetchMeteo(); },
    addHourRow() { addHourRow(); },
    removeHourRow() { removeHourRow(); },
    toggleDiurnal() { toggleDiurnal(); },
    toggleStability() { toggleStability(); },
    runSimulation() { runSimulation(); },
    exportResult() { exportResult(); },
    show2DView() { show2DView(); },
    changeLayer(el) {
        const layer = el.dataset.layer;
        if (layer) changeLayer(layer);
    },
    stepTime(el) {
        const delta = parseInt(el.dataset.delta);
        if (!isNaN(delta)) stepTime(delta);
    },
    updateRowHour(el) {
        el.closest('tr').dataset.hour = el.value;
    },
    updateArrow(el) {
        const deg = parseFloat(el.value) || 0;
        const span = el.closest("td")?.querySelector(".dir-arrow");
        if (!span) return;
        span.textContent = "↑";
        span.style.transform = `rotate(${(deg + 180) % 360}deg)`;
        span.style.display = "inline-block";
    },
    clear() {
        const btn = e.target.closest('[data-action="clear"]');
        if (btn) clearGeoJSON();
    },
};

const inputMap = {
    onTimeSlider(el) { onTimeSlider(el); },
    setTerrainExaggeration(el) { setTerrainExaggeration(el.value); },
};

/* ---- Init on DOMContentLoaded ---- */
document.addEventListener('DOMContentLoaded', () => {
    buildSidebar();
    initMap();
});
