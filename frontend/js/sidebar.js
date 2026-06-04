const panels = [
    { id: "dem-panel",     title: "Modelo Digital de Terreno"  },
    { id: "meteo-panel",   title: "Condiciones Meteorológicas" },
    { id: "surface-panel", title: "Superficie y Vegetación"    },
    { id: "mesh-panel",    title: "Resolución de Malla"       },
    { id: "diurnal-panel", title: "Vientos Diurnos"           },
    { id: "export-panel",  title: "Exportar Resultados"       },
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
    const dem = document.getElementById("dem-panel");
    dem.innerHTML = `
    <label>Seleccionar origen del DEM</label>
    <select id="dem-source">
      <option value="alos">ALOS World 3D (30m)</option>
      <option value="srtm">SRTM (30m)</option>
      <option value="upload">Subir archivo</option>
    </select>
    <button class="btn btn-primary" onclick="toggleDraw()">Seleccionar área en el mapa</button>
    <button class="btn" style="background:#585b70;color:#cdd6f4;margin-top:4px;" onclick="fetchDEM()">Descargar DEM</button>
    <p id="bbox-info" style="font-size:0.8rem;margin-top:4px;">Ningún área seleccionada</p>
  `;

    const meteo = document.getElementById("meteo-panel");
    meteo.innerHTML = `
    <label>Velocidad del viento (m/s)</label>
    <input type="number" id="wind-speed" value="5" min="0" step="0.5">
    <label>Dirección (grados, desde N)</label>
    <input type="range" id="wind-dir" min="0" max="360" value="270">
    <span id="wind-dir-label">270° (W)</span>
    <label>Altura del viento (m)</label>
    <input type="number" id="wind-height" value="10" min="0" step="1">
  `;
    document.getElementById("wind-dir").addEventListener("input", function () {
        document.getElementById("wind-dir-label").textContent = `${this.value}°`;
    });

    const surface = document.getElementById("surface-panel");
    surface.innerHTML = `
    <label>Vegetación</label>
    <select id="vegetation">
      <option value="grass">Hierba</option>
      <option value="brush">Matorral</option>
      <option value="trees">Árboles</option>
    </select>
  `;

    const mesh = document.getElementById("mesh-panel");
    mesh.innerHTML = `
    <label>Resolución de malla (m)</label>
    <input type="number" id="mesh-res" value="100" min="10" step="10">
  `;

    const diurnal = document.getElementById("diurnal-panel");
    diurnal.innerHTML = `
    <label><input type="checkbox" id="diurnal-toggle"> Vientos diurnos</label>
    <label>Temperatura (°C)</label>
    <input type="number" id="air-temp" value="25">
    <label>Cobertura nubosa (%)</label>
    <input type="range" id="cloud-cover" min="0" max="100" value="0">
    <label>Fecha y hora</label>
    <input type="datetime-local" id="sim-datetime">
  `;

    const exportP = document.getElementById("export-panel");
    exportP.innerHTML = `
    <button class="btn btn-success" onclick="runSimulation()">▶ Simular</button>
    <div id="progress-bar" style="display:none;margin-top:8px;">
      <div style="height:6px;background:#45475a;border-radius:3px;">
        <div id="progress-fill" style="height:100%;width:0%;background:#89b4fa;border-radius:3px;transition:width 0.3s;"></div>
      </div>
    </div>
    <hr style="margin:12px 0;border-color:#313244;">
    <label>Exportar</label>
    <select id="export-format">
      <option value="geotiff">GeoTIFF</option>
      <option value="gpkg">GeoPackage</option>
      <option value="kmz">KMZ (multi-capa)</option>
      <option value="ascii-zip">ASCII (ZIP)</option>
      <option value="pdf">PDF</option>
      <option value="vtk">VTK</option>
    </select>
    <button class="btn" id="export-btn" disabled style="background:#585b70;color:#cdd6f4;" onclick="exportResult()">Exportar</button>
  `;
}

document.addEventListener("DOMContentLoaded", buildSidebar);
