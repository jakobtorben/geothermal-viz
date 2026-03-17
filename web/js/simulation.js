/**
 * GeothermalViz Simulation Panel
 *
 * Handles the right-side simulation panel for setting up and running
 * Fimbul.jl geothermal simulations from well metadata.
 *
 * All parameter definitions, defaults, and simulation logic live on the
 * Julia backend. This module only handles UI rendering and API calls.
 */

// ── Well types that support simulation ───────────────────────────────────────
const SIMULATABLE_LAYERS = new Set(["EnergiBrønn", "BrønnPark"]);

// ── Simulation State ─────────────────────────────────────────────────────────
const simState = {
    currentSetup: null,   // Current simulation parameter set from backend
    results: null,        // Last simulation results
    isRunning: false,
};

// ── Initialisation ───────────────────────────────────────────────────────────

function initSimulationPanel() {
    document.getElementById("btn-setup-sim").addEventListener("click", () => {
        openSimPanel();
    });

    document.getElementById("btn-close-sim").addEventListener("click", () => {
        closeSimPanel();
    });

    document.querySelectorAll(".sim-tab").forEach(tab => {
        tab.addEventListener("click", () => {
            switchSimTab(tab.dataset.tab);
        });
    });

    document.getElementById("btn-run-sim").addEventListener("click", () => {
        runSimulation();
    });
}

// ── Panel open/close ─────────────────────────────────────────────────────────

async function openSimPanel() {
    const feature = window.GeothermalViz.state.selectedFeature;
    if (!feature) return;

    const props = feature.properties;
    const layerName = props.layer || "";
    if (!SIMULATABLE_LAYERS.has(layerName)) return;

    // Fetch simulation setup from Julia backend
    try {
        const resp = await fetch(`/api/simulation/setup`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(props),
        });
        const setup = await resp.json();

        if (!setup.simulatable) {
            return; // Should not happen given SIMULATABLE_LAYERS check, but be safe
        }

        simState.currentSetup = setup;
        renderSimSetup(setup);
        document.getElementById("sim-panel").classList.add("open");
        switchSimTab("setup");
    } catch (err) {
        console.error("Failed to fetch simulation setup:", err);
    }
}

function closeSimPanel() {
    document.getElementById("sim-panel").classList.remove("open");
}

// ── Show "Setup Simulation" button only for simulatable wells ────────────────

function showSimButton(feature) {
    const layerName = (feature && feature.properties && feature.properties.layer) || "";
    if (SIMULATABLE_LAYERS.has(layerName)) {
        document.getElementById("sim-setup-action").style.display = "block";
    } else {
        document.getElementById("sim-setup-action").style.display = "none";
    }
}

function hideSimButton() {
    document.getElementById("sim-setup-action").style.display = "none";
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

    // Parameters grouped by metadata group
    const paramsEl = document.getElementById("sim-params");
    const groups = {};

    for (const key of setup.parameter_order) {
        const meta = (setup.metadata && setup.metadata[key]) || { label: key, unit: "", group: "Other" };
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
    statusEl.textContent = "Simulation is running… this may take a few minutes.";

    const params = collectParams();
    const setup = {
        case_type: simState.currentSetup.case_type,
        parameters: params,
    };

    try {
        const resp = await fetch(`/api/simulation/run`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(setup),
        });
        const result = await resp.json();

        simState.results = result;
        simState.isRunning = false;
        runBtn.disabled = false;
        runBtn.textContent = "▶ Run Simulation";

        if (result.status === "completed") {
            statusEl.className = "sim-status completed";
            statusEl.textContent = result.message || "Simulation completed.";
            switchSimTab("results");
            renderResults(result);
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

    // Convert timestamps (seconds) to years
    const SECONDS_PER_YEAR = 365.25 * 24 * 3600;
    const tYears = timestamps.map(t => t / SECONDS_PER_YEAR);
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
                    showSimButton(data.feature);
                }
            }
        });
    }
});
