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
      ${allTimezones().map(tz => `<option value="${tz}">${tz} (${tzOffset(tz)})</option>`).join('')}
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
      <button class="btn-sm" data-action="fill24Hours" style="background:#585b70;color:#cdd6f4;">24h</button>
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
        <button class="step-btn" id="play-btn-sidebar" data-action="togglePlay" title="Play/pause">▶</button>
        <button class="step-btn" data-action="stepTime" data-delta="1" title="Next step">▶</button>
        <label id="time-label" style="font-size:0.75rem;margin:0;flex:1;text-align:center;">Step 1 / 1</label>
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
      <option value="presentation">Scenario to HTML</option>
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

export function fill24Hours() {
    const tbody = document.querySelector("#hourly-table tbody");
    tbody.innerHTML = "";
    for (let h = 0; h < 24; h++) {
        addHourRow(h, 5, 270, true);
    }
    appState.timeCount = 24;
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
        fill24Hours();
        const newRows = document.querySelectorAll("#hourly-table tbody tr");
        newRows.forEach(r => {
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

function tzOffset(tz) {
    try {
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en', { timeZone: tz, timeZoneName: 'shortOffset' });
        const parts = formatter.formatToParts(now);
        const off = parts.find(p => p.type === 'timeZoneName');
        return off ? off.value.replace('GMT', 'UTC') : '';
    } catch { return ''; }
}

function allTimezones() {
    if (typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function") {
        return ["UTC", ...Intl.supportedValuesOf("timeZone").filter(tz => tz !== "UTC").sort()];
    }
    return ["UTC",
        "Africa/Abidjan", "Africa/Accra", "Africa/Addis_Ababa", "Africa/Algiers", "Africa/Asmara",
        "Africa/Bamako", "Africa/Bangui", "Africa/Banjul", "Africa/Bissau", "Africa/Blantyre",
        "Africa/Brazzaville", "Africa/Bujumbura", "Africa/Cairo", "Africa/Casablanca", "Africa/Ceuta",
        "Africa/Conakry", "Africa/Dakar", "Africa/Dar_es_Salaam", "Africa/Djibouti", "Africa/Douala",
        "Africa/El_Aaiun", "Africa/Freetown", "Africa/Gaborone", "Africa/Harare", "Africa/Johannesburg",
        "Africa/Juba", "Africa/Kampala", "Africa/Khartoum", "Africa/Kigali", "Africa/Kinshasa",
        "Africa/Lagos", "Africa/Libreville", "Africa/Lome", "Africa/Luanda", "Africa/Lubumbashi",
        "Africa/Lusaka", "Africa/Malabo", "Africa/Maputo", "Africa/Maseru", "Africa/Mbabane",
        "Africa/Mogadishu", "Africa/Monrovia", "Africa/Nairobi", "Africa/Ndjamena", "Africa/Niamey",
        "Africa/Nouakchott", "Africa/Ouagadougou", "Africa/Porto-Novo", "Africa/Sao_Tome",
        "Africa/Tripoli", "Africa/Tunis", "Africa/Windhoek",
        "America/Adak", "America/Anchorage", "America/Anguilla", "America/Antigua",
        "America/Araguaina", "America/Argentina/Buenos_Aires", "America/Argentina/Catamarca",
        "America/Argentina/Cordoba", "America/Argentina/Jujuy", "America/Argentina/La_Rioja",
        "America/Argentina/Mendoza", "America/Argentina/Rio_Gallegos", "America/Argentina/Salta",
        "America/Argentina/San_Juan", "America/Argentina/San_Luis", "America/Argentina/Tucuman",
        "America/Argentina/Ushuaia", "America/Aruba", "America/Asuncion", "America/Atikokan",
        "America/Bahia", "America/Bahia_Banderas", "America/Barbados", "America/Belem",
        "America/Belize", "America/Blanc-Sablon", "America/Boa_Vista", "America/Bogota",
        "America/Boise", "America/Cambridge_Bay", "America/Campo_Grande", "America/Cancun",
        "America/Caracas", "America/Cayenne", "America/Cayman", "America/Chicago",
        "America/Chihuahua", "America/Costa_Rica", "America/Creston", "America/Cuiaba",
        "America/Curacao", "America/Danmarkshavn", "America/Dawson", "America/Dawson_Creek",
        "America/Denver", "America/Detroit", "America/Dominica", "America/Edmonton",
        "America/Eirunepe", "America/El_Salvador", "America/Fort_Nelson", "America/Fortaleza",
        "America/Glace_Bay", "America/Goose_Bay", "America/Grand_Turk", "America/Grenada",
        "America/Guadeloupe", "America/Guatemala", "America/Guayaquil", "America/Guyana",
        "America/Halifax", "America/Havana", "America/Hermosillo",
        "America/Indiana/Indianapolis", "America/Indiana/Knox", "America/Indiana/Marengo",
        "America/Indiana/Petersburg", "America/Indiana/Tell_City", "America/Indiana/Vevay",
        "America/Indiana/Vincennes", "America/Indiana/Winamac", "America/Inuvik", "America/Iqaluit",
        "America/Jamaica", "America/Juneau", "America/Kentucky/Louisville",
        "America/Kentucky/Monticello", "America/Kralendijk", "America/La_Paz", "America/Lima",
        "America/Los_Angeles", "America/Lower_Princes", "America/Maceio", "America/Managua",
        "America/Manaus", "America/Marigot", "America/Martinique", "America/Matamoros",
        "America/Mazatlan", "America/Menominee", "America/Merida", "America/Metlakatla",
        "America/Mexico_City", "America/Miquelon", "America/Moncton", "America/Monterrey",
        "America/Montevideo", "America/Montserrat", "America/Nassau", "America/New_York",
        "America/Nome", "America/Noronha", "America/North_Dakota/Beulah",
        "America/North_Dakota/Center", "America/North_Dakota/New_Salem", "America/Nuuk",
        "America/Ojinaga", "America/Panama", "America/Paramaribo", "America/Phoenix",
        "America/Port-au-Prince", "America/Port_of_Spain", "America/Porto_Velho",
        "America/Puerto_Rico", "America/Punta_Arenas", "America/Rankin_Inlet", "America/Recife",
        "America/Regina", "America/Resolute", "America/Rio_Branco", "America/Santarem",
        "America/Santiago", "America/Santo_Domingo", "America/Sao_Paulo", "America/Scoresbysund",
        "America/Sitka", "America/St_Barthelemy", "America/St_Johns", "America/St_Kitts",
        "America/St_Lucia", "America/St_Thomas", "America/St_Vincent", "America/Swift_Current",
        "America/Tegucigalpa", "America/Thule", "America/Tijuana", "America/Toronto",
        "America/Tortola", "America/Vancouver", "America/Whitehorse", "America/Winnipeg",
        "America/Yakutat", "Antarctica/Casey", "Antarctica/Davis", "Antarctica/DumontDUrville",
        "Antarctica/Macquarie", "Antarctica/Mawson", "Antarctica/McMurdo", "Antarctica/Palmer",
        "Antarctica/Rothera", "Antarctica/Syowa", "Antarctica/Troll", "Antarctica/Vostok",
        "Arctic/Longyearbyen", "Asia/Aden", "Asia/Almaty", "Asia/Amman", "Asia/Anadyr",
        "Asia/Aqtau", "Asia/Aqtobe", "Asia/Ashgabat", "Asia/Atyrau", "Asia/Baghdad",
        "Asia/Bahrain", "Asia/Baku", "Asia/Bangkok", "Asia/Barnaul", "Asia/Beirut",
        "Asia/Bishkek", "Asia/Brunei", "Asia/Chita", "Asia/Choibalsan", "Asia/Colombo",
        "Asia/Damascus", "Asia/Dhaka", "Asia/Dili", "Asia/Dubai", "Asia/Dushanbe",
        "Asia/Famagusta", "Asia/Gaza", "Asia/Hebron", "Asia/Ho_Chi_Minh", "Asia/Hong_Kong",
        "Asia/Hovd", "Asia/Irkutsk", "Asia/Jakarta", "Asia/Jayapura", "Asia/Jerusalem",
        "Asia/Kabul", "Asia/Kamchatka", "Asia/Karachi", "Asia/Kathmandu", "Asia/Khandyga",
        "Asia/Kolkata", "Asia/Krasnoyarsk", "Asia/Kuala_Lumpur", "Asia/Kuching", "Asia/Kuwait",
        "Asia/Macau", "Asia/Magadan", "Asia/Makassar", "Asia/Manila", "Asia/Muscat",
        "Asia/Nicosia", "Asia/Novokuznetsk", "Asia/Novosibirsk", "Asia/Omsk", "Asia/Oral",
        "Asia/Phnom_Penh", "Asia/Pontianak", "Asia/Pyongyang", "Asia/Qatar", "Asia/Qostanay",
        "Asia/Qyzylorda", "Asia/Riyadh", "Asia/Sakhalin", "Asia/Samarkand", "Asia/Seoul",
        "Asia/Shanghai", "Asia/Singapore", "Asia/Srednekolymsk", "Asia/Taipei", "Asia/Tashkent",
        "Asia/Tbilisi", "Asia/Tehran", "Asia/Thimphu", "Asia/Tokyo", "Asia/Tomsk",
        "Asia/Ulaanbaatar", "Asia/Urumqi", "Asia/Ust-Nera", "Asia/Vientiane",
        "Asia/Vladivostok", "Asia/Yakutsk", "Asia/Yangon", "Asia/Yekaterinburg", "Asia/Yerevan",
        "Atlantic/Azores", "Atlantic/Bermuda", "Atlantic/Canary", "Atlantic/Cape_Verde",
        "Atlantic/Faroe", "Atlantic/Madeira", "Atlantic/Reykjavik", "Atlantic/South_Georgia",
        "Atlantic/Stanley", "Australia/Adelaide", "Australia/Brisbane", "Australia/Broken_Hill",
        "Australia/Darwin", "Australia/Eucla", "Australia/Hobart", "Australia/Lindeman",
        "Australia/Lord_Howe", "Australia/Melbourne", "Australia/Perth", "Australia/Sydney",
        "Europe/Amsterdam", "Europe/Andorra", "Europe/Astrakhan", "Europe/Athens",
        "Europe/Belgrade", "Europe/Berlin", "Europe/Bratislava", "Europe/Brussels",
        "Europe/Bucharest", "Europe/Budapest", "Europe/Chisinau", "Europe/Copenhagen",
        "Europe/Dublin", "Europe/Gibraltar", "Europe/Guernsey", "Europe/Helsinki",
        "Europe/Isle_of_Man", "Europe/Istanbul", "Europe/Jersey", "Europe/Kaliningrad",
        "Europe/Kirov", "Europe/Kyiv", "Europe/Lisbon", "Europe/Ljubljana", "Europe/London",
        "Europe/Luxembourg", "Europe/Madrid", "Europe/Malta", "Europe/Mariehamn", "Europe/Minsk",
        "Europe/Monaco", "Europe/Moscow", "Europe/Oslo", "Europe/Paris", "Europe/Podgorica",
        "Europe/Prague", "Europe/Riga", "Europe/Rome", "Europe/Samara", "Europe/San_Marino",
        "Europe/Sarajevo", "Europe/Saratov", "Europe/Simferopol", "Europe/Skopje", "Europe/Sofia",
        "Europe/Stockholm", "Europe/Tallinn", "Europe/Tirane", "Europe/Ulyanovsk", "Europe/Vaduz",
        "Europe/Vatican", "Europe/Vienna", "Europe/Vilnius", "Europe/Volgograd", "Europe/Warsaw",
        "Europe/Zagreb", "Europe/Zurich",
        "Indian/Antananarivo", "Indian/Chagos", "Indian/Christmas", "Indian/Cocos",
        "Indian/Comoro", "Indian/Kerguelen", "Indian/Mahe", "Indian/Maldives",
        "Indian/Mauritius", "Indian/Mayotte", "Indian/Reunion",
        "Pacific/Apia", "Pacific/Auckland", "Pacific/Bougainville", "Pacific/Chatham",
        "Pacific/Chuuk", "Pacific/Easter", "Pacific/Efate", "Pacific/Enderbury",
        "Pacific/Fakaofo", "Pacific/Fiji", "Pacific/Funafuti", "Pacific/Galapagos",
        "Pacific/Gambier", "Pacific/Guadalcanal", "Pacific/Guam", "Pacific/Honolulu",
        "Pacific/Kanton", "Pacific/Kiritimati", "Pacific/Kosrae", "Pacific/Kwajalein",
        "Pacific/Majuro", "Pacific/Marquesas", "Pacific/Nauru", "Pacific/Niue",
        "Pacific/Norfolk", "Pacific/Noumea", "Pacific/Pago_Pago", "Pacific/Palau",
        "Pacific/Pitcairn", "Pacific/Pohnpei", "Pacific/Port_Moresby", "Pacific/Rarotonga",
        "Pacific/Saipan", "Pacific/Tahiti", "Pacific/Tarawa", "Pacific/Tongatapu",
        "Pacific/Wake", "Pacific/Wallis"
    ];
}
