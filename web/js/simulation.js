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
    pollTimer: null,      // Polling timer for async simulation
    lastLogCount: 0,      // Track last seen log line count
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

    // Reset status and log
    document.getElementById("sim-status").style.display = "none";
    document.getElementById("sim-output-log").style.display = "none";
    document.getElementById("sim-log-content").innerHTML = "";
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

// ── Simulation output log ────────────────────────────────────────────────────

function showOutputLog() {
    const logEl = document.getElementById("sim-output-log");
    logEl.style.display = "block";
    document.getElementById("sim-log-content").innerHTML = "";
    simState.lastLogCount = 0;
}

function appendLogLines(lines) {
    const contentEl = document.getElementById("sim-log-content");
    const startIdx = simState.lastLogCount;
    for (let i = startIdx; i < lines.length; i++) {
        const lineEl = document.createElement("div");
        lineEl.className = "sim-log-line";
        lineEl.textContent = lines[i];
        contentEl.appendChild(lineEl);
    }
    simState.lastLogCount = lines.length;
    // Auto-scroll to bottom
    contentEl.scrollTop = contentEl.scrollHeight;
}

// ── Run simulation (async with polling) ──────────────────────────────────────

async function runSimulation() {
    if (simState.isRunning || !simState.currentSetup) return;
    simState.isRunning = true;

    const statusEl = document.getElementById("sim-status");
    const runBtn = document.getElementById("btn-run-sim");
    runBtn.disabled = true;
    runBtn.textContent = "⏳ Running…";
    statusEl.style.display = "block";
    statusEl.className = "sim-status running";
    statusEl.textContent = "Starting simulation…";

    showOutputLog();

    const params = collectParams();
    const setup = {
        case_type: simState.currentSetup.case_type,
        parameters: params,
    };

    try {
        // Start async simulation
        const resp = await fetch(`/api/simulation/start`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(setup),
        });
        const startResult = await resp.json();

        if (startResult.status === "error") {
            simState.isRunning = false;
            runBtn.disabled = false;
            runBtn.textContent = "▶ Run Simulation";
            statusEl.className = "sim-status error";
            statusEl.textContent = startResult.message || "Failed to start simulation.";
            return;
        }

        // Start polling for status
        simState.pollTimer = setInterval(() => pollSimulationStatus(), 1000);

    } catch (err) {
        simState.isRunning = false;
        runBtn.disabled = false;
        runBtn.textContent = "▶ Run Simulation";
        statusEl.className = "sim-status error";
        statusEl.textContent = `Error: ${err.message}`;
    }
}

async function pollSimulationStatus() {
    try {
        const resp = await fetch(`/api/simulation/status`);
        const status = await resp.json();

        // Update log
        if (status.log && status.log.length > simState.lastLogCount) {
            appendLogLines(status.log);
        }

        // Check if simulation is done
        if (!status.running && status.result !== null) {
            clearInterval(simState.pollTimer);
            simState.pollTimer = null;
            simState.isRunning = false;

            const result = status.result;
            simState.results = result;

            const runBtn = document.getElementById("btn-run-sim");
            const statusEl = document.getElementById("sim-status");
            runBtn.disabled = false;
            runBtn.textContent = "▶ Run Simulation";

            if (result.status === "completed") {
                statusEl.className = "sim-status completed";
                statusEl.textContent = result.message || "Simulation completed.";
                renderResultsInPanel(result);
                switchSimTab("results");
            } else {
                statusEl.className = "sim-status error";
                statusEl.textContent = result.message || "Simulation failed.";
            }
        }
    } catch (err) {
        console.error("Polling error:", err);
    }
}

// ── Render results inside the side panel ─────────────────────────────────────

function renderResultsInPanel(result) {
    const container = document.getElementById("sim-results-content");

    if (!result.well_data || Object.keys(result.well_data).length === 0) {
        container.innerHTML = `<p class="no-selection">No well data in results.</p>`;
        return;
    }

    const wellNames = Object.keys(result.well_data);
    const hasReservoirVars = result.reservoir_vars && result.reservoir_vars.length > 0;

    let html = `<p class="sim-result-msg">${result.message}</p>`;
    html += `<div class="sim-result-summary">`;
    html += `<p><strong>Wells:</strong> ${wellNames.join(", ")}</p>`;
    html += `<p><strong>Timesteps:</strong> ${result.num_steps}</p>`;
    if (hasReservoirVars) {
        html += `<p><strong>Reservoir variables:</strong> ${result.reservoir_vars.join(", ")}</p>`;
    }
    html += `</div>`;

    // Well output section
    html += `<div class="sim-result-section">`;
    html += `<h3>🧪 Well Output</h3>`;
    html += `<div class="sim-result-controls">`;
    html += `<div class="sim-result-control-row">`;
    html += `<label>Well:</label>`;
    html += `<select id="result-well-select" class="sim-result-select">`;
    for (const wname of wellNames) {
        html += `<option value="${wname}">${wname}</option>`;
    }
    html += `</select></div>`;
    html += `<div class="sim-result-control-row">`;
    html += `<label>Variable:</label>`;
    html += `<select id="result-var-select" class="sim-result-select"></select>`;
    html += `</div></div>`;
    html += `<div class="sim-result-chart-wrap"><canvas id="result-chart-canvas"></canvas></div>`;
    html += `</div>`;

    container.innerHTML = html;

    // Set up variable dropdown for first well
    populateVarSelect(result, wellNames[0]);

    // Event listeners
    document.getElementById("result-well-select").addEventListener("change", (e) => {
        populateVarSelect(result, e.target.value);
        drawResultChart(result);
    });
    document.getElementById("result-var-select").addEventListener("change", () => {
        drawResultChart(result);
    });

    // Draw initial chart
    drawResultChart(result);
}

function populateVarSelect(result, wellName) {
    const select = document.getElementById("result-var-select");
    select.innerHTML = "";
    if (result.well_data && result.well_data[wellName]) {
        for (const vname of Object.keys(result.well_data[wellName])) {
            const opt = document.createElement("option");
            opt.value = vname;
            opt.textContent = vname;
            select.appendChild(opt);
        }
    }
}

// ── Well Output Chart (in side panel) ────────────────────────────────────────

function drawResultChart(result) {
    const wellName = document.getElementById("result-well-select").value;
    const varName = document.getElementById("result-var-select").value;

    if (!wellName || !varName) return;
    const wellVars = result.well_data[wellName];
    if (!wellVars || !wellVars[varName]) return;

    const values = wellVars[varName];
    const timestamps = result.timestamps;

    const canvas = document.getElementById("result-chart-canvas");
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const container = canvas.parentElement;
    const rect = container.getBoundingClientRect();
    const w = Math.max(200, rect.width - 10);
    const h = 260;

    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    // Convert timestamps (days) to years
    const DAYS_PER_YEAR = 365.25;
    const timeVals = timestamps.map(t => t / DAYS_PER_YEAR);
    const timeUnit = "years";

    const tMin = Math.min(...timeVals);
    const tMax = Math.max(...timeVals);

    let vMin = Math.min(...values);
    let vMax = Math.max(...values);
    if (vMin === vMax) { vMin -= 1; vMax += 1; }
    const vPad = (vMax - vMin) * 0.05;
    vMin -= vPad;
    vMax += vPad;

    const pad = { top: 15, right: 15, bottom: 42, left: 70 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    // Background
    ctx.fillStyle = "#fafbfc";
    ctx.fillRect(0, 0, w, h);

    // Border
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = 1;
    ctx.strokeRect(pad.left, pad.top, plotW, plotH);

    // Grid lines
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 0.5;
    for (let i = 1; i < 5; i++) {
        const y = pad.top + (plotH * i / 5);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(pad.left + plotW, y);
        ctx.stroke();
    }
    for (let i = 1; i < 5; i++) {
        const x = pad.left + (plotW * i / 5);
        ctx.beginPath();
        ctx.moveTo(x, pad.top);
        ctx.lineTo(x, pad.top + plotH);
        ctx.stroke();
    }

    // Data line
    const tRange = (tMax - tMin) || 1;
    const vRange = (vMax - vMin) || 1;
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < values.length; i++) {
        const x = pad.left + ((timeVals[i] - tMin) / tRange) * plotW;
        const y = pad.top + (1 - (values[i] - vMin) / vRange) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Y-axis label (use variable name which includes unit from backend)
    ctx.save();
    ctx.fillStyle = "#475569";
    ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.translate(13, pad.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText(varName, 0, 0);
    ctx.restore();

    // X-axis label
    ctx.fillStyle = "#475569";
    ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`Time [${timeUnit}]`, pad.left + plotW / 2, h - 3);

    // Y-axis ticks
    ctx.fillStyle = "#64748b";
    ctx.font = "10px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "right";
    for (let i = 0; i <= 5; i++) {
        const val = vMax - (i / 5) * (vMax - vMin);
        const y = pad.top + (plotH * i / 5);
        ctx.fillText(val.toFixed(1), pad.left - 6, y + 4);
    }

    // X-axis ticks
    ctx.textAlign = "center";
    for (let i = 0; i <= 5; i++) {
        const val = tMin + (i / 5) * (tMax - tMin);
        const x = pad.left + (plotW * i / 5);
        ctx.fillText(val.toFixed(1), x, pad.top + plotH + 16);
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
