import { appState, apiPost } from './state.js';
import { setStatus } from './simulation.js';

const panels = [
    { id: "terrain-panel", title: "Digital Terrain Model" },
    { id: "meteo-panel", title: "Meteorological Conditions" },
    { id: "export-panel", title: "Export Results" },
];

export function buildSidebar() {
    const container = document.getElementById("meteo-panels");
    container.innerHTML = panels
        .map((p) => `
      <div class="accordion-panel">
        <div class="accordion-header" data-panel="${p.id}">
          ${p.title} <span>▼</span>
        </div>
        <div class="accordion-body" id="${p.id}"></div>
      </div>`)
        .join("");

    container.addEventListener("click", (e) => {
        const header = e.target.closest(".accordion-header");
        if (!header) return;
        const panelId = header.dataset.panel;
        const body = document.getElementById(panelId);
        const isOpen = body.classList.contains("open");
        document.querySelectorAll(".accordion-body").forEach((b) => b.classList.remove("open"));
        document.querySelectorAll(".accordion-header span").forEach((s) => (s.textContent = "▼"));
        if (!isOpen) {
            body.classList.add("open");
            header.querySelector("span").textContent = "▲";
        }
    });

    fillPanels();
}

function fillPanels() {
    const terrain = document.getElementById("terrain-panel");
    terrain.innerHTML = `
    <label>Timezone</label>
    <select id="timezone">
      <option value="UTC">UTC</option>
      <option value="US/Mountain">Mountain (US)</option>
      <option value="US/Eastern">Eastern (US)</option>
      <option value="US/Pacific">Pacific (US)</option>
      <option value="Europe/Madrid">Europe/Madrid</option>
      <option value="Europe/London">Europe/London</option>
    </select>
    <hr style="margin:6px 0;border-color:#313244;">
    <label>DEM Source</label>
    <select id="dem-source">
      <option value="srtm">SRTM (30m)</option>
      <option value="alos">ALOS AW3D30 (30m)</option>
      <option value="cop30">COP30 (30m)</option>
      <option value="upload">Upload own file</option>
    </select>
    <button class="btn btn-primary" data-action="toggleDraw">Select area</button>
    <button id="fetch-dem-btn" class="btn" style="background:#585b70;color:#cdd6f4;" data-action="fetchDEM">Download DEM</button>
    <input type="file" id="file-upload-input" accept=".tif,.tiff,.asc,.bil"
           style="display:none" data-action="uploadDEM">
    <p id="bbox-info" style="font-size:0.75rem;margin-top:3px;">No area selected</p>
    <hr style="margin:6px 0;border-color:#313244;">
    <label>Import GeoJSON</label>
    <button class="btn" style="background:#585b70;color:#cdd6f4;" data-action="importGeoJSON">Import GeoJSON</button>
    <button class="btn-sm" data-action="clearGeoJSON" style="margin-top:3px;">Clear</button>
    <hr style="margin:6px 0;border-color:#313244;">
    <label>Vegetation</label>
    <select id="vegetation">
      <option value="grass">Grass</option>
      <option value="brush">Brush</option>
      <option value="trees">Trees</option>
    </select>
    <label>Mesh resolution (m)</label>
    <input type="number" id="mesh-res" value="100" min="10" step="10">
    <hr style="margin:6px 0;border-color:#313244;">
    <label>Vertical exaggeration</label>
    <div style="display:flex;gap:6px;align-items:center;">
      <input type="range" id="exaggeration-slider" min="0.5" max="5" step="0.1" value="1.5"
             data-action="setTerrainExaggeration" data-event="input" style="flex:1;">
      <span id="exaggeration-value" style="font-size:0.8rem;min-width:35px;">1.5x</span>
    </div>
  `;

    const meteo = document.getElementById("meteo-panel");
    meteo.innerHTML = `
    <label>Wind height (m)</label>
    <input type="number" id="wind-height" value="10" min="0" step="1">
    <hr style="margin:6px 0;border-color:#313244;">
    <label>Input mode</label>
    <select id="meteo-mode" data-action="toggleMeteoMode">
      <option value="manual">Manual</option>
      <option value="openmeteo">Open-Meteo</option>
    </select>
    <div id="openmeteo-controls" style="display:none;margin-top:4px;">
      <label>Model</label>
      <select id="meteo-model">
        <option value="ecmwf_ifs025">IFS (ECMWF 25km)</option>
        <option value="gfs_seamless">GFS (NOAA)</option>
        <option value="era5">ERA5 (reanalysis)</option>
      </select>
      <label>Date</label>
      <input type="date" id="meteo-date">
      <button class="btn" style="background:#585b70;color:#cdd6f4;margin-top:6px;" data-action="fetchMeteo" id="meteo-fetch-btn">Fetch data</button>
      <p id="meteo-status" style="font-size:0.75rem;margin-top:3px;display:none;"></p>
    </div>
    <hr style="margin:6px 0;border-color:#313244;">
    <table class="sheet-table" id="hourly-table">
      <thead>
        <tr>
          <th style="width:36px;">Hour</th>
          <th style="width:44px;">Wind</th>
          <th style="width:54px;">Dir.°</th>
          <th style="width:80px;">Date</th>
          <th style="width:24px;">Cld</th>
          <th style="width:28px;">°C</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
    <div style="display:flex;gap:4px;">
      <button class="btn-sm" data-action="addHourRow">+ row</button>
      <button class="btn-sm" data-action="removeHourRow">− row</button>
    </div>
    <hr style="margin:8px 0;border-color:#313244;">
    <label><input type="checkbox" id="diurnal-toggle" data-action="toggleDiurnal"> Diurnal winds</label>
    <label><input type="checkbox" id="stability-toggle" data-action="toggleStability"> Atmospheric stability</label>
  `;
    for (let h = 0; h < 4; h++) {
        addHourRow(8 + h * 4, 5, 270, true);
    }

    const exportP = document.getElementById("export-panel");
    exportP.innerHTML = `
    <button id="sim-btn" class="btn btn-success" data-action="runSimulation">▶ Simulate</button>
    <div id="progress-bar" style="display:none;margin-top:6px;">
      <div style="height:4px;background:#45475a;border-radius:2px;">
        <div id="progress-fill" style="height:100%;width:0%;background:#89b4fa;border-radius:2px;transition:width 0.3s;"></div>
      </div>
    </div>
    <div id="status-msg" class="status-msg" style="display:none;margin-top:4px;"></div>
    <div id="time-slider-container" style="display:none;margin-top:6px;">
      <div style="display:flex;align-items:center;gap:4px;justify-content:center;">
        <button class="step-btn" data-action="stepTime" data-delta="-1" title="Previous step">◀</button>
        <label id="time-label" style="font-size:0.75rem;margin:0;flex:1;text-align:center;">Step 1 / 1</label>
        <button class="step-btn" data-action="stepTime" data-delta="1" title="Next step">▶</button>
      </div>
      <input type="range" id="time-slider" min="0" max="0" value="0"
             data-action="onTimeSlider" data-event="input" style="width:100%;">
    </div>
    <hr style="margin:10px 0;border-color:#313244;">
    <label>Export</label>
    <select id="export-format">
      <option value="geotiff">GeoTIFF</option>
      <option value="gpkg">GeoPackage</option>
      <option value="kmz">KMZ</option>
      <option value="ascii-zip">ASCII (ZIP)</option>
      <option value="pdf">PDF</option>
      <option value="vtk">VTK</option>
    </select>
    <button class="btn" id="export-btn" disabled style="background:#585b70;color:#cdd6f4;" data-action="exportResult">Export</button>
  `;
}

export function toggleDiurnal() {
    updateDialOpts();
}

export function toggleStability() {
    updateDialOpts();
}

function updateDialOpts() {
    const diurnal = document.getElementById("diurnal-toggle").checked;
    const stability = document.getElementById("stability-toggle").checked;
    const enabled = diurnal || stability;
    const rows = document.querySelectorAll("#hourly-table tbody tr");
    rows.forEach((r) => {
        const inputs = r.querySelectorAll("input");
        if (inputs.length >= 6) {
            inputs[3].disabled = !enabled;
            inputs[4].disabled = !enabled;
            inputs[5].disabled = !enabled;
        }
    });
}

export function addHourRow(hour, speed, dir, skipFocus) {
    if (hour === undefined) {
        const rows = document.querySelectorAll("#hourly-table tbody tr");
        const last = rows[rows.length - 1];
        hour = last ? parseInt(last.dataset.hour) + 1 : 0;
        speed = 5;
        dir = 270;
    }
    const enabled = document.getElementById("diurnal-toggle").checked ||
        document.getElementById("stability-toggle").checked;
    const today = new Date().toISOString().slice(0, 10);
    const tr = document.createElement("tr");
    tr.dataset.hour = hour;
    tr.innerHTML = `
    <td><input type="number" value="${hour}" min="0" max="23" step="1" data-action="updateRowHour"></td>
    <td><input type="number" value="${speed}" min="0" step="0.5"></td>
    <td>
      <div class="dir-cell">
        <input type="number" value="${dir}" min="0" max="360" step="1" data-action="updateArrow">
        <span class="dir-arrow">↑</span>
      </div>
    </td>
    <td><input type="date" value="${today}" ${enabled ? "" : "disabled"}></td>
    <td><input type="number" min="0" max="100" value="0" ${enabled ? "" : "disabled"}></td>
    <td><input type="number" value="25" min="-40" max="200" step="1" ${enabled ? "" : "disabled"}></td>
  `;
    document.querySelector("#hourly-table tbody").appendChild(tr);
    const dirInput = tr.querySelector(".dir-cell input[type=number]");
    if (dirInput) updateArrow(dirInput);
    appState.timeCount = document.querySelectorAll("#hourly-table tbody tr").length;
}

export function removeHourRow() {
    const rows = document.querySelectorAll("#hourly-table tbody tr");
    if (rows.length <= 1) return;
    rows[rows.length - 1].remove();
    appState.timeCount = document.querySelectorAll("#hourly-table tbody tr").length;
}

function updateArrow(input) {
    const deg = parseFloat(input.value) || 0;
    const span = input?.closest("td")?.querySelector(".dir-arrow");
    if (!span) return;
    span.textContent = "↑";
    span.style.transform = `rotate(${(deg + 180) % 360}deg)`;
    span.style.display = "inline-block";
}

export function getHourlyData() {
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

/* ---- Open-Meteo integration ---- */
export function toggleMeteoMode() {
    const mode = document.getElementById("meteo-mode").value;
    const ctrl = document.getElementById("openmeteo-controls");
    const rows = document.querySelectorAll("#hourly-table tbody tr");
    const enabled = document.getElementById("diurnal-toggle").checked ||
        document.getElementById("stability-toggle").checked;

    if (mode === "openmeteo") {
        ctrl.style.display = "block";
        document.getElementById("meteo-date").value = new Date().toISOString().slice(0, 10);
        rows.forEach(r => {
            const inputs = r.querySelectorAll("input");
            if (inputs.length >= 6) {
                inputs[3].disabled = true;
                inputs[4].disabled = true;
                inputs[5].disabled = true;
            }
        });
    } else {
        ctrl.style.display = "none";
        rows.forEach(r => {
            const inputs = r.querySelectorAll("input");
            if (inputs.length >= 6) {
                inputs[3].disabled = !enabled;
                inputs[4].disabled = !enabled;
                inputs[5].disabled = !enabled;
            }
        });
    }
}

export async function fetchMeteo() {
    if (!appState.bbox) {
        setStatus?.("Select an area on the map first", "error");
        return;
    }

    const btn = document.getElementById("meteo-fetch-btn");
    const statusEl = document.getElementById("meteo-status");
    const origText = btn.textContent;
    btn.innerHTML = '<span class="spinner"></span> Fetching…';
    btn.disabled = true;
    statusEl.style.display = "none";

    const lat = (appState.bbox.north + appState.bbox.south) / 2;
    const lon = (appState.bbox.east + appState.bbox.west) / 2;
    const model = document.getElementById("meteo-model").value;
    const date = document.getElementById("meteo-date").value;
    const tz = document.getElementById("timezone").value;
    const rows = document.querySelectorAll("#hourly-table tbody tr");
    const hours = Array.from(rows).map(r => parseInt(r.dataset.hour) || 0);

    try {
        const resp = await apiPost("/api/meteo/fetch", {
            lat, lon, model, date, hours, timezone: tz,
        });

        if (!resp.available) {
            statusEl.textContent = "⚠ " + (resp.reason || "No data for this date/model");
            statusEl.className = "status-msg error";
            statusEl.style.display = "block";
            return;
        }

        const lookup = {};
        resp.hourly.forEach(d => { lookup[d.hour] = d; });

        rows.forEach((r) => {
            const inputs = r.querySelectorAll("input");
            const h = parseInt(r.dataset.hour) || 0;
            const data = lookup[h];
            if (data) {
                inputs[1].value = data.speed;
                inputs[2].value = data.direction;
                inputs[3].value = date;
                inputs[4].value = data.cloud;
                inputs[5].value = data.temp;
                updateArrow(inputs[2]);
            }
        });

        statusEl.textContent = "✓ Data fetched from " + model;
        statusEl.className = "status-msg success";
        statusEl.style.display = "block";
    } catch (e) {
        statusEl.textContent = "⚠ Error: " + e.message;
        statusEl.className = "status-msg error";
        statusEl.style.display = "block";
    } finally {
        btn.innerHTML = origText;
        btn.disabled = false;
    }
}
