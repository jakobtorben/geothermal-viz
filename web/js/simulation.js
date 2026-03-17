/**
 * GeothermalViz Simulation Panel
 *
 * Handles the right-side simulation panel for setting up and running
 * Fimbul.jl geothermal simulations from well metadata.
 */

// ── Physical constants ───────────────────────────────────────────────────────
const WATER_VOLUMETRIC_HEAT_CAPACITY = 4.18e6;  // ρ·cp of water [J/(m³·K)]
const ASSUMED_DELTA_T = 5.0;                     // assumed ΔT for flow rate estimate [K]
const SECONDS_PER_HOUR = 3600.0;
const DAYS_PER_YEAR = 365.25;

// Mock simulation shape parameters
const MOCK_TEMP_DECAY_FACTOR = 0.3;   // logarithmic production temperature decline
const MOCK_SEASONAL_AMPLITUDE = 0.5;  // seasonal oscillation amplitude [K]
const MOCK_BTES_WARMUP_FRACTION = 4;  // fraction of total steps for BTES warm-up

// ── Simulation State ─────────────────────────────────────────────────────────
const simState = {
    currentSetup: null,   // Current simulation parameter set from backend
    results: null,        // Last simulation results
    isRunning: false,
};

// ── Parameter defaults (client-side fallback) ────────────────────────────────
const OSLO_DEFAULTS = {
    surface_temperature: 7.0,
    geothermal_gradient: 0.025,
    rock_thermal_conductivity: 3.0,
    rock_heat_capacity: 850.0,
    porosity: 0.01,
    permeability: 0.1,
};

const CASE_TYPE_MAP = {
    "EnergiBrønn":       "AGS",
    "GrunnvannBrønn":    "DOUBLET",
    "BrønnPark":         "BTES",
    "Sonderboring":      "AGS",
    "LGNBrønn":          "AGS",
    "GrunnvannOppkomme": "DOUBLET",
    "LGNOmrådeRefPkt":   "AGS",
};

const CASE_LABELS = {
    AGS:     "Advanced Geothermal System (AGS)",
    BTES:    "Borehole Thermal Energy Storage (BTES)",
    DOUBLET: "Geothermal Doublet",
};

const CASE_DESCRIPTIONS = {
    AGS:     "Closed-loop heat exchanger in a single deep borehole. Suitable for individual energy wells.",
    BTES:    "Array of closely-spaced boreholes for seasonal heat storage. Suitable for well parks.",
    DOUBLET: "Conventional doublet with an injection and production well in a layered reservoir.",
};

const PARAM_META = {
    well_depth:                { label: "Well depth",              unit: "m",       min: 10,    max: 8000,  step: 10,    group: "Well Geometry" },
    borehole_diameter:         { label: "Borehole diameter",       unit: "mm",      min: 50,    max: 500,   step: 1,     group: "Well Geometry" },
    surface_temperature:       { label: "Surface temperature",     unit: "°C",      min: -10,   max: 40,    step: 0.5,   group: "Rock Properties" },
    geothermal_gradient:       { label: "Geothermal gradient",     unit: "K/m",     min: 0.01,  max: 0.10,  step: 0.005, group: "Rock Properties" },
    rock_thermal_conductivity: { label: "Thermal conductivity",    unit: "W/(m·K)", min: 0.5,   max: 10.0,  step: 0.1,   group: "Rock Properties" },
    rock_heat_capacity:        { label: "Rock heat capacity",      unit: "J/(kg·K)",min: 100,   max: 2000,  step: 50,    group: "Rock Properties" },
    porosity:                  { label: "Porosity",                unit: "–",       min: 0.001, max: 0.5,   step: 0.01,  group: "Rock Properties" },
    permeability:              { label: "Permeability",            unit: "mD",      min: 0.001, max: 5000,  step: 1,     group: "Rock Properties" },
    temperature_inj:           { label: "Injection temperature",   unit: "°C",      min: 5,     max: 100,   step: 1,     group: "Operation" },
    flow_rate:                 { label: "Flow rate",               unit: "m³/h",    min: 1,     max: 500,   step: 1,     group: "Operation" },
    num_years:                 { label: "Simulation years",        unit: "yr",      min: 1,     max: 500,   step: 1,     group: "Simulation" },
    num_wells_btes:            { label: "Number of wells",         unit: "–",       min: 4,     max: 200,   step: 1,     group: "BTES Layout" },
    num_sectors:               { label: "Number of sectors",       unit: "–",       min: 1,     max: 20,    step: 1,     group: "BTES Layout" },
    well_spacing:              { label: "Well spacing",            unit: "m",       min: 2,     max: 20,    step: 0.5,   group: "BTES Layout" },
    temperature_charge:        { label: "Charge temperature",      unit: "°C",      min: 30,    max: 150,   step: 1,     group: "Operation" },
    temperature_discharge:     { label: "Discharge temperature",   unit: "°C",      min: 5,     max: 50,    step: 1,     group: "Operation" },
    rate_charge:               { label: "Charge rate",             unit: "L/s",     min: 0.1,   max: 50,    step: 0.1,   group: "Operation" },
    spacing_top:               { label: "Surface well spacing",    unit: "m",       min: 10,    max: 500,   step: 10,    group: "Doublet Geometry" },
    spacing_bottom:            { label: "Reservoir well spacing",  unit: "m",       min: 100,   max: 5000,  step: 50,    group: "Doublet Geometry" },
    depth_deviation:           { label: "Deviation depth",         unit: "m",       min: 100,   max: 5000,  step: 50,    group: "Doublet Geometry" },
};

const CASE_PARAMS = {
    AGS: [
        "well_depth", "borehole_diameter",
        "surface_temperature", "geothermal_gradient",
        "rock_thermal_conductivity", "rock_heat_capacity",
        "porosity", "permeability",
        "temperature_inj", "flow_rate", "num_years",
    ],
    BTES: [
        "well_depth", "num_wells_btes", "num_sectors", "well_spacing",
        "surface_temperature", "geothermal_gradient",
        "rock_thermal_conductivity", "rock_heat_capacity",
        "temperature_charge", "temperature_discharge",
        "rate_charge", "num_years",
    ],
    DOUBLET: [
        "well_depth", "borehole_diameter",
        "spacing_top", "spacing_bottom", "depth_deviation",
        "surface_temperature", "geothermal_gradient",
        "rock_thermal_conductivity", "rock_heat_capacity",
        "porosity", "permeability",
        "temperature_inj", "flow_rate", "num_years",
    ],
};

const PARAM_DEFAULTS = {
    well_depth: 200, borehole_diameter: 140,
    surface_temperature: 7.0, geothermal_gradient: 0.025,
    rock_thermal_conductivity: 3.0, rock_heat_capacity: 850,
    porosity: 0.01, permeability: 0.1,
    temperature_inj: 25, flow_rate: 25, num_years: 25,
    num_wells_btes: 48, num_sectors: 6, well_spacing: 5.0,
    temperature_charge: 90, temperature_discharge: 10, rate_charge: 0.5,
    spacing_top: 100, spacing_bottom: 1000, depth_deviation: 800,
};

// ── Initialisation ───────────────────────────────────────────────────────────

function initSimulationPanel() {
    // Setup Simulation button
    document.getElementById("btn-setup-sim").addEventListener("click", () => {
        openSimPanel();
    });

    // Close button
    document.getElementById("btn-close-sim").addEventListener("click", () => {
        closeSimPanel();
    });

    // Tab switching
    document.querySelectorAll(".sim-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            switchSimTab(tab.dataset.tab);
        });
    });

    // Run button
    document.getElementById("btn-run-sim").addEventListener("click", () => {
        runSimulation();
    });
}

// ── Panel open/close ─────────────────────────────────────────────────────────

function openSimPanel() {
    const feature = window.GeothermalViz.state.selectedFeature;
    if (!feature) return;

    const setup = buildSimulationSetup(feature.properties);
    simState.currentSetup = setup;

    renderSimSetup(setup);
    document.getElementById("sim-panel").classList.add("open");
    switchSimTab("setup");
}

function closeSimPanel() {
    document.getElementById("sim-panel").classList.remove("open");
}

// ── Show "Setup Simulation" button when well selected ────────────────────────

function showSimButton() {
    document.getElementById("sim-setup-action").style.display = "block";
}

function hideSimButton() {
    document.getElementById("sim-setup-action").style.display = "none";
}

// ── Build setup from well properties (client-side) ───────────────────────────

function buildSimulationSetup(props) {
    const layerName = props.layer || "EnergiBrønn";
    const caseType = CASE_TYPE_MAP[layerName] || "AGS";
    const paramKeys = CASE_PARAMS[caseType];

    const parameters = {};
    const sources = {};

    for (const key of paramKeys) {
        const result = resolveParam(key, props);
        parameters[key] = result.value;
        sources[key] = result.source;
    }

    const wellId = props.brønnNr
        ? `Well #${props.brønnNr}`
        : (props.brønnParkNr ? `Well Park #${props.brønnParkNr}` : "Selected Well");

    return {
        case_type: caseType,
        case_label: CASE_LABELS[caseType],
        case_description: CASE_DESCRIPTIONS[caseType],
        well_id: wellId,
        parameters,
        parameter_order: paramKeys,
        sources,
    };
}

function resolveParam(key, props) {
    // Try to derive from well metadata
    if (key === "well_depth" && props.boretLengde != null) {
        return { value: parseFloat(props.boretLengde), source: "data" };
    }
    if (key === "borehole_diameter" && props.diameterBorehull != null) {
        return { value: parseFloat(props.diameterBorehull), source: "data" };
    }
    if (key === "num_wells_btes" && props.antallEnergiBrønner != null) {
        return { value: Math.max(4, Math.round(parseFloat(props.antallEnergiBrønner))), source: "data" };
    }
    if (key === "flow_rate" && props.brønnpVEffekt != null) {
        const power = parseFloat(props.brønnpVEffekt);
        const rate = (power / (WATER_VOLUMETRIC_HEAT_CAPACITY * ASSUMED_DELTA_T)) * SECONDS_PER_HOUR;
        return { value: Math.max(1, Math.round(rate * 10) / 10), source: "data" };
    }

    return { value: PARAM_DEFAULTS[key] ?? 0, source: "default" };
}

// ── Render simulation setup form ─────────────────────────────────────────────

function renderSimSetup(setup) {
    // Case info
    const caseInfo = document.getElementById("sim-case-info");
    caseInfo.innerHTML = `
        <div class="sim-well-id">${setup.well_id}</div>
        <div class="sim-case-badge">${setup.case_label}</div>
        <p class="sim-case-desc">${setup.case_description}</p>
    `;

    // Parameters grouped
    const paramsEl = document.getElementById("sim-params");
    const groups = {};

    for (const key of setup.parameter_order) {
        const meta = PARAM_META[key] || { label: key, unit: "", group: "Other" };
        const group = meta.group || "Other";
        if (!groups[group]) groups[group] = [];
        groups[group].push({ key, meta });
    }

    let html = "";
    for (const [groupName, items] of Object.entries(groups)) {
        html += `<div class="sim-param-group"><h3>${groupName}</h3>`;
        for (const { key, meta } of items) {
            const value = setup.parameters[key];
            const source = setup.sources[key];
            const sourceClass = source === "data" ? "source-data" : "source-default";
            const sourceLabel = source === "data" ? "from well data" : "default";
            html += `
                <div class="sim-param-row">
                    <label for="sim-p-${key}">
                        ${meta.label}
                        <span class="sim-param-unit">${meta.unit}</span>
                    </label>
                    <div class="sim-param-input-wrap">
                        <input type="number" id="sim-p-${key}" data-param="${key}"
                               value="${value}" min="${meta.min}" max="${meta.max}" step="${meta.step}"
                               class="sim-param-input">
                        <span class="sim-param-source ${sourceClass}" title="${sourceLabel}">
                            ${source === "data" ? "📊" : "⚙️"}
                        </span>
                    </div>
                </div>
            `;
        }
        html += `</div>`;
    }
    paramsEl.innerHTML = html;

    // Reset status
    document.getElementById("sim-status").style.display = "none";
    document.getElementById("sim-panel-title").textContent = `Simulation — ${setup.well_id}`;
}

// ── Tab switching ────────────────────────────────────────────────────────────

function switchSimTab(tab) {
    document.querySelectorAll(".sim-tab").forEach(t => t.classList.toggle("active", t.dataset.tab === tab));
    document.getElementById("sim-setup").classList.toggle("active", tab === "setup");
    document.getElementById("sim-results").classList.toggle("active", tab === "results");
}

// ── Collect current parameters from the form ─────────────────────────────────

function collectParams() {
    const params = {};
    document.querySelectorAll("#sim-params .sim-param-input").forEach(input => {
        params[input.dataset.param] = parseFloat(input.value);
    });
    return params;
}

// ── Run simulation ───────────────────────────────────────────────────────────

async function runSimulation() {
    if (simState.isRunning || !simState.currentSetup) return;
    simState.isRunning = true;

    const statusEl = document.getElementById("sim-status");
    const runBtn = document.getElementById("btn-run-sim");
    runBtn.disabled = true;
    runBtn.textContent = "⏳ Running…";
    statusEl.style.display = "block";
    statusEl.className = "sim-status running";
    statusEl.textContent = "Simulation is running…";

    const params = collectParams();
    const setup = {
        case_type: simState.currentSetup.case_type,
        parameters: params,
    };

    try {
        let result;
        // Try Julia backend first
        if (CONFIG.apiBase) {
            const resp = await fetch(`${CONFIG.apiBase}/api/simulation/run`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(setup),
            });
            result = await resp.json();
        } else {
            // Client-side mock when no server
            result = mockSimulation(setup);
        }

        simState.results = result;
        simState.isRunning = false;
        runBtn.disabled = false;
        runBtn.textContent = "▶ Run Simulation";

        if (result.status === "completed") {
            statusEl.className = "sim-status completed";
            statusEl.textContent = result.message || "Simulation completed.";
            renderResults(result);
            switchSimTab("results");
        } else {
            statusEl.className = "sim-status error";
            statusEl.textContent = result.message || "Simulation failed.";
        }
    } catch (err) {
        simState.isRunning = false;
        runBtn.disabled = false;
        runBtn.textContent = "▶ Run Simulation";
        statusEl.className = "sim-status error";
        statusEl.textContent = `Error: ${err.message}`;
    }
}

// ── Client-side mock simulation (when no Julia backend) ──────────────────────

function mockSimulation(setup) {
    const params = setup.parameters;
    const nYears = params.num_years || 25;
    const nSteps = nYears * 12;
    const dt = Array.from({ length: nSteps }, (_, i) => (i / nSteps) * nYears * DAYS_PER_YEAR);

    const depth = params.well_depth || 200;
    const Ts = params.surface_temperature || 7.0;
    const grad = params.geothermal_gradient || 0.025;
    const Tb = Ts + grad * depth;

    const Tprod = dt.map(t => Tb - MOCK_TEMP_DECAY_FACTOR * Math.log(1 + t / DAYS_PER_YEAR) + MOCK_SEASONAL_AMPLITUDE * Math.sin(2 * Math.PI * t / DAYS_PER_YEAR));

    const wellData = {};
    if (setup.case_type === "DOUBLET") {
        wellData["Producer"] = {
            "Temperature [°C]": Tprod,
            "Rate [m³/h]": Array(nSteps).fill(-(params.flow_rate || 25)),
        };
        wellData["Injector"] = {
            "Temperature [°C]": Array(nSteps).fill(params.temperature_inj || 25),
            "Rate [m³/h]": Array(nSteps).fill(params.flow_rate || 25),
        };
    } else if (setup.case_type === "AGS") {
        wellData["Producer"] = {
            "Temperature [°C]": Tprod,
            "Rate [m³/h]": Array(nSteps).fill(params.flow_rate || 25),
        };
    } else {
        const Tc = params.temperature_charge || 90;
        const Tout = dt.map((t, i) => Ts + (Tc - Ts) * (1 - Math.exp(-i / (nSteps / MOCK_BTES_WARMUP_FRACTION))) * (0.5 + MOCK_SEASONAL_AMPLITUDE * Math.sin(2 * Math.PI * t / DAYS_PER_YEAR)));
        wellData["BTES Array"] = {
            "Temperature [°C]": Tout,
            "Rate [L/s]": Array(nSteps).fill(params.rate_charge || 0.5),
        };
    }

    return {
        status: "completed",
        message: "Client-side mock simulation completed. Connect to Julia server for real results.",
        well_data: wellData,
        timestamps: dt,
        num_steps: nSteps,
    };
}

// ── Render simulation results ────────────────────────────────────────────────

function renderResults(result) {
    const container = document.getElementById("sim-results-content");

    if (!result.well_data || Object.keys(result.well_data).length === 0) {
        container.innerHTML = `<p class="no-selection">No well data in results.</p>`;
        return;
    }

    let html = `<p class="sim-result-msg">${result.message}</p>`;

    for (const [wellName, wellVars] of Object.entries(result.well_data)) {
        html += `<div class="sim-result-well"><h3>${wellName}</h3>`;

        for (const [varName, values] of Object.entries(wellVars)) {
            if (!Array.isArray(values) || values.length === 0) continue;

            const canvasId = `chart-${wellName}-${varName}`.replace(/[^a-zA-Z0-9-]/g, "_");
            html += `
                <div class="sim-result-var">
                    <h4>${varName}</h4>
                    <canvas id="${canvasId}" class="sim-chart"></canvas>
                </div>
            `;
        }
        html += `</div>`;
    }

    container.innerHTML = html;

    // Draw charts using canvas
    for (const [wellName, wellVars] of Object.entries(result.well_data)) {
        for (const [varName, values] of Object.entries(wellVars)) {
            if (!Array.isArray(values) || values.length === 0) continue;
            const canvasId = `chart-${wellName}-${varName}`.replace(/[^a-zA-Z0-9-]/g, "_");
            drawSimChart(canvasId, result.timestamps, values, varName);
        }
    }
}

// ── Simple canvas chart ──────────────────────────────────────────────────────

function drawSimChart(canvasId, timestamps, values, label) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const pad = { top: 10, right: 15, bottom: 30, left: 55 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    // Convert timestamps to years
    const tYears = timestamps.map(t => t / 365.25);
    const tMin = Math.min(...tYears);
    const tMax = Math.max(...tYears);

    let vMin = Math.min(...values);
    let vMax = Math.max(...values);
    if (vMin === vMax) { vMin -= 1; vMax += 1; }
    const vPad = (vMax - vMin) * 0.05;
    vMin -= vPad;
    vMax += vPad;

    // Background
    ctx.fillStyle = "#fafbfc";
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = "#e8e8e8";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
        const y = pad.top + (plotH * i / 4);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + plotW, y);
        ctx.stroke();
    }

    // Data line
    ctx.strokeStyle = "#3498db";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < values.length; i++) {
        const x = pad.left + ((tYears[i] - tMin) / (tMax - tMin)) * plotW;
        const y = pad.top + (1 - (values[i] - vMin) / (vMax - vMin)) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Axes labels
    ctx.fillStyle = "#666";
    ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText("Time (years)", pad.left + plotW / 2, h - 4);

    // Y-axis ticks
    ctx.textAlign = "right";
    for (let i = 0; i <= 4; i++) {
        const val = vMax - (i / 4) * (vMax - vMin);
        const y = pad.top + (plotH * i / 4);
        ctx.fillText(val.toFixed(1), pad.left - 5, y + 4);
    }

    // X-axis ticks
    ctx.textAlign = "center";
    for (let i = 0; i <= 4; i++) {
        const val = tMin + (i / 4) * (tMax - tMin);
        const x = pad.left + (plotW * i / 4);
        ctx.fillText(val.toFixed(0), x, pad.top + plotH + 15);
    }
}

// ── Hook into main app lifecycle ─────────────────────────────────────────────

// Wait for DOM then initialise
if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initSimulationPanel);
} else {
    initSimulationPanel();
}

// Register as extension to react to well selection events
window.addEventListener("load", () => {
    if (window.GeothermalViz) {
        window.GeothermalViz.registerExtension({
            name: "SimulationPanel",
            onEvent(event, data) {
                if (event === "wellSelected") {
                    showSimButton();
                }
            }
        });
    }
});
