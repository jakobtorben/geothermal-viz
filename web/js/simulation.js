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
    // Results overlay state
    currentStep: 0,
    totalSteps: 0,
    playTimer: null,
    isPlaying: false,
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

    // Results overlay controls
    initResultsOverlay();
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

    // If switching to results and we have results, show the overlay
    if (tab === "results" && simState.results && simState.results.status === "completed") {
        showResultsOverlay();
    }
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
                renderResultsSummary(result);
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

// ── Render results summary in side panel ─────────────────────────────────────

function renderResultsSummary(result) {
    const container = document.getElementById("sim-results-content");

    if (!result.well_data || Object.keys(result.well_data).length === 0) {
        container.innerHTML = `<p class="no-selection">No well data in results.</p>`;
        return;
    }

    const wellNames = Object.keys(result.well_data);
    const hasReservoir = result.reservoir_states && result.reservoir_states.steps;

    let html = `<p class="sim-result-msg">${result.message}</p>`;
    html += `<div class="sim-result-summary">`;
    html += `<p><strong>Wells:</strong> ${wellNames.join(", ")}</p>`;
    html += `<p><strong>Timesteps:</strong> ${result.num_steps}</p>`;
    if (hasReservoir) {
        html += `<p><strong>3D States:</strong> ${result.reservoir_states.steps.length} snapshots</p>`;
    }
    html += `</div>`;
    html += `<button class="btn-primary btn-view-results" onclick="showResultsOverlay()">🔍 View Full Results</button>`;

    container.innerHTML = html;
}

// ── Results overlay ──────────────────────────────────────────────────────────

function initResultsOverlay() {
    // Close overlay
    document.getElementById("btn-close-overlay").addEventListener("click", () => {
        hideResultsOverlay();
    });

    // Tab switching in overlay
    document.getElementById("overlay-tab-setup").addEventListener("click", () => {
        hideResultsOverlay();
        switchSimTab("setup");
    });

    document.getElementById("overlay-tab-results").addEventListener("click", () => {
        // Already on results — no-op
    });

    // Step controls
    document.getElementById("step-first").addEventListener("click", () => setStep(0));
    document.getElementById("step-prev").addEventListener("click", () => setStep(simState.currentStep - 1));
    document.getElementById("step-next").addEventListener("click", () => setStep(simState.currentStep + 1));
    document.getElementById("step-last").addEventListener("click", () => setStep(simState.totalSteps - 1));
    document.getElementById("step-play").addEventListener("click", togglePlay);
    document.getElementById("step-slider").addEventListener("input", (e) => {
        setStep(parseInt(e.target.value));
    });

    // Variable selectors
    document.getElementById("reservoir-var-select").addEventListener("change", () => {
        updateReservoir3D();
    });
    document.getElementById("show-delta").addEventListener("change", () => {
        updateReservoir3D();
    });
    document.getElementById("well-select").addEventListener("change", () => {
        populateWellVarSelect();
        updateWellChart();
    });
    document.getElementById("well-var-select").addEventListener("change", () => {
        updateWellChart();
    });
}

function showResultsOverlay() {
    const result = simState.results;
    if (!result || result.status !== "completed") return;

    const overlay = document.getElementById("results-overlay");
    overlay.style.display = "flex";

    // Populate dropdowns
    populateReservoirVarSelect(result);
    populateWellSelect(result);

    // Set up step controls
    const rs = result.reservoir_states;
    if (rs && rs.steps) {
        simState.totalSteps = rs.steps.length;
    } else {
        simState.totalSteps = 1;
    }
    simState.currentStep = 0;

    const slider = document.getElementById("step-slider");
    slider.max = Math.max(0, simState.totalSteps - 1);
    slider.value = 0;
    updateStepLabel();

    // Render initial views
    updateReservoir3D();
    updateWellChart();
}

function hideResultsOverlay() {
    document.getElementById("results-overlay").style.display = "none";
    stopPlay();
}

function populateReservoirVarSelect(result) {
    const select = document.getElementById("reservoir-var-select");
    select.innerHTML = "";
    const rs = result.reservoir_states;
    if (rs && rs.variables) {
        for (const v of rs.variables) {
            const opt = document.createElement("option");
            opt.value = v;
            opt.textContent = v;
            select.appendChild(opt);
        }
    }
}

function populateWellSelect(result) {
    const select = document.getElementById("well-select");
    select.innerHTML = "";
    if (result.well_data) {
        for (const wname of Object.keys(result.well_data)) {
            const opt = document.createElement("option");
            opt.value = wname;
            opt.textContent = wname;
            select.appendChild(opt);
        }
    }
    populateWellVarSelect();
}

function populateWellVarSelect() {
    const wellName = document.getElementById("well-select").value;
    const select = document.getElementById("well-var-select");
    select.innerHTML = "";
    if (simState.results && simState.results.well_data && simState.results.well_data[wellName]) {
        for (const vname of Object.keys(simState.results.well_data[wellName])) {
            const opt = document.createElement("option");
            opt.value = vname;
            opt.textContent = vname;
            select.appendChild(opt);
        }
    }
}

// ── Step controls ────────────────────────────────────────────────────────────

function setStep(step) {
    step = Math.max(0, Math.min(step, simState.totalSteps - 1));
    simState.currentStep = step;
    document.getElementById("step-slider").value = step;
    updateStepLabel();
    updateReservoir3D();
    updateWellChart();
}

function updateStepLabel() {
    document.getElementById("step-label").textContent =
        `Step ${simState.currentStep + 1} / ${simState.totalSteps}`;
}

function togglePlay() {
    if (simState.isPlaying) {
        stopPlay();
    } else {
        startPlay();
    }
}

function startPlay() {
    simState.isPlaying = true;
    document.getElementById("step-play").textContent = "⏸";
    simState.playTimer = setInterval(() => {
        if (simState.currentStep < simState.totalSteps - 1) {
            setStep(simState.currentStep + 1);
        } else {
            stopPlay();
        }
    }, 800);
}

function stopPlay() {
    simState.isPlaying = false;
    document.getElementById("step-play").textContent = "▶";
    if (simState.playTimer) {
        clearInterval(simState.playTimer);
        simState.playTimer = null;
    }
}

// ── 3D Reservoir Visualization (Plotly.js) ───────────────────────────────────

function updateReservoir3D() {
    const result = simState.results;
    if (!result) return;

    const rs = result.reservoir_states;
    const plotDiv = document.getElementById("reservoir-3d-plot");

    if (!rs || !rs.steps || !rs.grid) {
        plotDiv.innerHTML = `<p class="no-selection">No 3D reservoir data available.</p>`;
        return;
    }

    if (typeof Plotly === "undefined") {
        plotDiv.innerHTML = `<p class="no-selection">Plotly.js not loaded. 3D visualization unavailable.</p>`;
        return;
    }

    const variable = document.getElementById("reservoir-var-select").value;
    const showDelta = document.getElementById("show-delta").checked;
    const step = simState.currentStep;

    const grid = rs.grid;
    let values = rs.steps[step][variable];

    if (!values) {
        plotDiv.innerHTML = `<p class="no-selection">Variable "${variable}" not found at step ${step + 1}.</p>`;
        return;
    }

    // If showing delta, subtract initial state
    if (showDelta && step > 0) {
        const initial = rs.steps[0][variable];
        if (initial) {
            values = values.map((v, i) => v - initial[i]);
        }
    }

    const units = { "Pressure": "bar", "Temperature": "°C" };
    const unit = units[variable] || "";
    const title = showDelta && step > 0
        ? `Δ${variable} at step ${step + 1} [${unit}]`
        : `${variable} at step ${step + 1} [${unit}]`;

    const trace = {
        type: "isosurface",
        x: grid.x,
        y: grid.y,
        z: grid.z,
        value: values,
        colorscale: variable === "Temperature" ? "RdBu" : "Viridis",
        reversescale: variable === "Temperature",
        isomin: Math.min(...values),
        isomax: Math.max(...values),
        surface: { count: 3, fill: 0.8 },
        caps: {
            x: { show: true, fill: 0.6 },
            y: { show: true, fill: 0.6 },
            z: { show: true, fill: 0.6 },
        },
        colorbar: {
            title: `${variable} [${unit}]`,
            titleside: "right",
            thickness: 20,
            len: 0.7,
        },
    };

    const layout = {
        title: { text: title, font: { size: 14 } },
        margin: { l: 0, r: 0, t: 40, b: 0 },
        scene: {
            xaxis: { title: "x" },
            yaxis: { title: "y" },
            zaxis: { title: "z" },
            aspectmode: "data",
        },
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
    };

    const config = {
        responsive: true,
        displayModeBar: true,
        modeBarButtonsToRemove: ["toImage"],
    };

    Plotly.react(plotDiv, [trace], layout, config);
}

// ── Well Output Chart ────────────────────────────────────────────────────────

function updateWellChart() {
    const result = simState.results;
    if (!result || !result.well_data) return;

    const wellName = document.getElementById("well-select").value;
    const varName = document.getElementById("well-var-select").value;

    if (!wellName || !varName) return;
    const wellVars = result.well_data[wellName];
    if (!wellVars || !wellVars[varName]) return;

    const values = wellVars[varName];
    const timestamps = result.timestamps;
    drawWellOutputChart("well-chart-canvas", timestamps, values, varName);
}

function drawWellOutputChart(canvasId, timestamps, values, label) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const container = canvas.parentElement;
    const rect = container.getBoundingClientRect();
    const w = rect.width - 20;
    const h = Math.max(300, rect.height - 20);

    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    canvas.width = w * dpr;
    canvas.height = h * dpr;

    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    const pad = { top: 20, right: 30, bottom: 45, left: 65 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    // Convert timestamps (days) to appropriate unit
    const DAYS_PER_YEAR = 365.25;
    const maxDays = Math.max(...timestamps);
    let timeVals, timeUnit;
    if (maxDays > 365) {
        timeVals = timestamps.map(t => t / DAYS_PER_YEAR);
        timeUnit = "years";
    } else {
        timeVals = [...timestamps];
        timeUnit = "days";
    }

    const tMin = Math.min(...timeVals);
    const tMax = Math.max(...timeVals);

    let vMin = Math.min(...values);
    let vMax = Math.max(...values);
    if (vMin === vMax) { vMin -= 1; vMax += 1; }
    const vPad = (vMax - vMin) * 0.05;
    vMin -= vPad;
    vMax += vPad;

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
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < values.length; i++) {
        const x = pad.left + ((timeVals[i] - tMin) / (tMax - tMin || 1)) * plotW;
        const y = pad.top + (1 - (values[i] - vMin) / (vMax - vMin || 1)) * plotH;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    ctx.stroke();

    // Current step marker (red dot)
    const rs = simState.results && simState.results.reservoir_states;
    if (rs && rs.step_indices) {
        const stepIdx = rs.step_indices[simState.currentStep];
        if (stepIdx !== undefined && stepIdx > 0 && stepIdx <= values.length) {
            const idx = stepIdx - 1; // Convert 1-based to 0-based
            const mx = pad.left + ((timeVals[idx] - tMin) / (tMax - tMin || 1)) * plotW;
            const my = pad.top + (1 - (values[idx] - vMin) / (vMax - vMin || 1)) * plotH;
            ctx.fillStyle = "#dc2626";
            ctx.beginPath();
            ctx.arc(mx, my, 5, 0, 2 * Math.PI);
            ctx.fill();
        }
    }

    // Y-axis label
    ctx.save();
    ctx.fillStyle = "#475569";
    ctx.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.translate(15, pad.top + plotH / 2);
    ctx.rotate(-Math.PI / 2);
    const varUnits = { "temperature": "°C", "mass_rate": "kg/s", "pressure": "bar" };
    const unit = varUnits[label.toLowerCase()] || "";
    ctx.fillText(`${label} [${unit}]`, 0, 0);
    ctx.restore();

    // X-axis label
    ctx.fillStyle = "#475569";
    ctx.font = "12px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`Time (${timeUnit})`, pad.left + plotW / 2, h - 5);

    // Y-axis ticks
    ctx.fillStyle = "#64748b";
    ctx.font = "11px -apple-system, BlinkMacSystemFont, sans-serif";
    ctx.textAlign = "right";
    for (let i = 0; i <= 5; i++) {
        const val = vMax - (i / 5) * (vMax - vMin);
        const y = pad.top + (plotH * i / 5);
        ctx.fillText(val.toFixed(1), pad.left - 8, y + 4);
    }

    // X-axis ticks
    ctx.textAlign = "center";
    for (let i = 0; i <= 5; i++) {
        const val = tMin + (i / 5) * (tMax - tMin);
        const x = pad.left + (plotW * i / 5);
        ctx.fillText(val.toFixed(1), x, pad.top + plotH + 18);
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
