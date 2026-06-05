const panels = [
    { id: "terrain-panel",  title: "Modelo Digital de Terreno" },
    { id: "meteo-panel",    title: "Condiciones Meteorológicas" },
    { id: "export-panel",   title: "Exportar Resultados" },
];

function buildSidebar() {
    const container = document.getElementById("meteo-panels");
    container.innerHTML = panels
        .map(
            (p) => `
      <div class="accordion-panel">
        <div class="accordion-header" data-panel="${p.id}">
          ${p.title} <span>▼</span>
        </div>
        <div class="accordion-body" id="${p.id}"></div>
      </div>`
        )
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
    <label>Zona horaria</label>
    <select id="timezone">
      <option value="UTC">UTC</option>
      <option value="US/Mountain">Mountain (US)</option>
      <option value="US/Eastern">Eastern (US)</option>
      <option value="US/Pacific">Pacific (US)</option>
      <option value="Europe/Madrid">Europe/Madrid</option>
      <option value="Europe/London">Europe/London</option>
    </select>
    <hr style="margin:6px 0;border-color:#313244;">
    <label>Origen del DEM</label>
    <select id="dem-source">
      <option value="srtm">SRTM (30m)</option>
      <option value="alos">ALOS AW3D30 (30m)</option>
      <option value="cop30">COP30 (30m)</option>
      <option value="upload">Subir archivo propio</option>
    </select>
    <button class="btn btn-primary" onclick="toggleDraw()">Seleccionar área</button>
    <button id="fetch-dem-btn" class="btn" style="background:#585b70;color:#cdd6f4;" onclick="fetchDEM()">Descargar DEM</button>
    <input type="file" id="file-upload-input" accept=".tif,.tiff,.asc,.bil"
           style="display:none" onchange="uploadDEM(this.files[0])">
    <p id="bbox-info" style="font-size:0.75rem;margin-top:3px;">Ningún área seleccionada</p>
    <hr style="margin:6px 0;border-color:#313244;">
    <label>Importar GeoJSON</label>
    <button class="btn" style="background:#585b70;color:#cdd6f4;" onclick="document.getElementById('geojson-file-input').click()">Importar GeoJSON</button>
    <button class="btn-sm" onclick="clearGeoJSON();alert('GeoJSON eliminado')" style="margin-top:3px;">Limpiar</button>
    <hr style="margin:6px 0;border-color:#313244;">
    <label>Vegetación</label>
    <select id="vegetation">
      <option value="grass">Hierba</option>
      <option value="brush">Matorral</option>
      <option value="trees">Árboles</option>
    </select>
    <label>Resolución de malla (m)</label>
    <input type="number" id="mesh-res" value="100" min="10" step="10">
  `;

    const meteo = document.getElementById("meteo-panel");
    meteo.innerHTML = `
    <label>Altura del viento (m)</label>
    <input type="number" id="wind-height" value="10" min="0" step="1">
    <hr style="margin:6px 0;border-color:#313244;">
    <table class="sheet-table" id="hourly-table">
      <thead>
        <tr>
          <th style="width:36px;">Hora</th>
          <th style="width:44px;">Viento</th>
          <th style="width:54px;">Dir.°</th>
          <th style="width:80px;">Fecha</th>
          <th style="width:24px;">Nub</th>
          <th style="width:28px;">°C</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>
    <div style="display:flex;gap:4px;">
      <button class="btn-sm" onclick="addHourRow()">+ fila</button>
      <button class="btn-sm" onclick="removeHourRow()">− fila</button>
    </div>
    <hr style="margin:8px 0;border-color:#313244;">
    <label><input type="checkbox" id="diurnal-toggle" onchange="toggleDiurnal()"> Vientos diurnos</label>
    <label><input type="checkbox" id="stability-toggle" onchange="toggleStability()"> Estabilidad atmosférica</label>
  `;
    for (let h = 0; h < 4; h++) {
        addHourRow(8 + h * 4, 5, 270);
    }

    const exportP = document.getElementById("export-panel");
    exportP.innerHTML = `
    <button id="sim-btn" class="btn btn-success" onclick="runSimulation()">▶ Simular</button>
    <div id="progress-bar" style="display:none;margin-top:6px;">
      <div style="height:4px;background:#45475a;border-radius:2px;">
        <div id="progress-fill" style="height:100%;width:0%;background:#89b4fa;border-radius:2px;transition:width 0.3s;"></div>
      </div>
    </div>
    <div id="status-msg" class="status-msg" style="display:none;margin-top:4px;"></div>
    <div id="time-slider-container" style="display:none;margin-top:6px;">
      <label id="time-label" style="font-size:0.75rem;">Paso 1 / 1</label>
      <input type="range" id="time-slider" min="0" max="0" value="0"
             oninput="onTimeSlider(this)" style="width:100%;">
    </div>
    <hr style="margin:10px 0;border-color:#313244;">
    <label>Exportar</label>
    <select id="export-format">
      <option value="geotiff">GeoTIFF</option>
      <option value="gpkg">GeoPackage</option>
      <option value="kmz">KMZ</option>
      <option value="ascii-zip">ASCII (ZIP)</option>
      <option value="pdf">PDF</option>
      <option value="vtk">VTK</option>
    </select>
    <button class="btn" id="export-btn" disabled style="background:#585b70;color:#cdd6f4;" onclick="exportResult()">Exportar</button>
  `;
}

function toggleDiurnal() {
    updateDialOpts();
}

function toggleStability() {
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
            inputs[3].disabled = !enabled; // date
            inputs[4].disabled = !enabled; // cloud
            inputs[5].disabled = !enabled; // temp
        }
    });
}

function addHourRow(hour, speed, dir) {
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
    <td><input type="number" value="${hour}" min="0" max="23" step="1" onchange="this.closest('tr').dataset.hour=this.value"></td>
    <td><input type="number" value="${speed}" min="0" step="0.5"></td>
    <td>
      <div class="dir-cell">
        <input type="number" value="${dir}" min="0" max="360" step="1" oninput="updateArrow(this)">
        <span class="dir-arrow">↑</span>
      </div>
    </td>
    <td><input type="date" value="${today}" ${enabled ? "" : "disabled"}></td>
    <td><input type="number" min="0" max="100" value="0" ${enabled ? "" : "disabled"}></td>
    <td><input type="number" value="25" min="-40" max="200" step="1" ${enabled ? "" : "disabled"}></td>
  `;
    document.querySelector("#hourly-table tbody").appendChild(tr);
    updateArrow(tr.querySelector(".dir-cell input[type=number]"));
    appState.timeCount = document.querySelectorAll("#hourly-table tbody tr").length;
}

function removeHourRow() {
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

function getHourlyData() {
    const rows = document.querySelectorAll("#hourly-table tbody tr");
    const speeds = [], directions = [], dates = [], clouds = [], temps = [];
    rows.forEach((r) => {
        const inputs = r.querySelectorAll("input");
        speeds.push(parseFloat(inputs[1].value) || 0);
        directions.push(parseFloat(inputs[2].value) || 0);
        dates.push(inputs[3].value || "");    // date
        clouds.push(parseInt(inputs[4].value) || 0);  // cloud
        temps.push(parseFloat(inputs[5].value) || 0); // temp
    });
    return { speeds, directions, dates, clouds, temps, count: speeds.length };
}

document.addEventListener("DOMContentLoaded", buildSidebar);