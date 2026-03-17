/**
 * GeothermalViz - Interactive borehole map visualization
 *
 * Architecture: Modular design with extension support.
 * - Data loading via fetch (static files or Julia API server)
 * - MapLibre GL JS for rendering with terrain and 3D buildings
 * - Event-driven design for extensibility
 */

// ── Configuration ──────────────────────────────────────────────────────────
const CONFIG = {
    // Try API server first, fall back to static files
    apiBase: null, // Set to e.g. "http://localhost:8080" when using Julia server
    dataPath: "processed_data",

    map: {
        center: [10.75, 59.91], // Oslo
        zoom: 11,
        pitch: 45,
        bearing: -10,
        maxZoom: 18,
        minZoom: 8
    },

    layers: {
        "EnergiBrønn":        { id: "energibronn",    color: "#e74c3c", label: "Energy Well" },
        "GrunnvannBrønn":     { id: "grunnvannbronn", color: "#3498db", label: "Groundwater Well" },
        "BrønnPark":          { id: "bronnpark",      color: "#2ecc71", label: "Well Park" },
        "Sonderboring":       { id: "sonderboring",   color: "#f39c12", label: "Probe Drilling" },
        "LGNBrønn":           { id: "other",          color: "#9b59b6", label: "LGN Well" },
        "GrunnvannOppkomme":  { id: "other",          color: "#9b59b6", label: "Spring" },
        "LGNOmrådeRefPkt":    { id: "other",          color: "#9b59b6", label: "LGN Ref. Point" }
    },

    // Human-readable field labels (Norwegian → English)
    fieldLabels: {
        "brønnNr":              "Well No.",
        "objekttype":           "Type",
        "boretLengde":          "Drilled Length (m)",
        "boretLengdeTilBerg":   "Depth to Bedrock (m)",
        "boreDato":             "Drill Date",
        "diameterBorehull":     "Borehole Diameter (mm)",
        "vannstandBorehull":    "Water Level (m)",
        "boretKapasitet":       "Capacity (l/h)",
        "materialForingsrør":   "Casing Material",
        "lengdeForingsrør":     "Casing Length (m)",
        "brønnHelningType":     "Inclination Type",
        "boretHelningsgrad":    "Inclination (°)",
        "boretAzimuth":         "Azimuth (°)",
        "oppdragstaker":        "Contractor",
        "konsulentFirma":       "Consultant",
        "beskrivelse":          "Description",
        "brønnParkNr":          "Well Park No.",
        "brønnpOmrNavn":        "Area Name",
        "antallEnergiBrønner":  "No. of Energy Wells",
        "brønnpVEffekt":        "Heating Power (kW)",
        "brønnpVEnergi":        "Heating Energy (MWh)",
        "brønnpKEffekt":        "Cooling Power (kW)",
        "brønnpKEnergi":        "Cooling Energy (MWh)",
        "brønnpFrikjøling":     "Free Cooling",
        "brønnpKollVæske":      "Collector Fluid",
        "geolMedium":           "Geological Medium",
        "layer":                "Layer"
    }
};

// ── Application State ──────────────────────────────────────────────────────
const state = {
    map: null,
    data: null,
    selectedFeature: null,
    popup: null,
    extensions: []
};

// ── Data Loading ───────────────────────────────────────────────────────────

/**
 * Load GeoJSON data from the Julia API server or static files.
 */
async function loadBoreholeData() {
    // Try Julia API server first
    if (CONFIG.apiBase) {
        try {
            const resp = await fetch(`${CONFIG.apiBase}/api/data/all_boreholes`);
            if (resp.ok) return resp.json();
        } catch (e) {
            console.warn("API server not available, falling back to static files");
        }
    }

    // Fall back to static file
    const resp = await fetch(`${CONFIG.dataPath}/all_boreholes.geojson`);
    if (!resp.ok) throw new Error(`Failed to load data: ${resp.status}`);
    return resp.json();
}

// ── Map Initialization ─────────────────────────────────────────────────────

function initMap() {
    const map = new maplibregl.Map({
        container: "map",
        style: {
            version: 8,
            name: "GeothermalViz",
            sources: {
                "osm-raster": {
                    type: "raster",
                    tiles: [
                        "https://tile.openstreetmap.org/{z}/{x}/{y}.png"
                    ],
                    tileSize: 256,
                    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
                }
            },
            layers: [
                {
                    id: "osm-base",
                    type: "raster",
                    source: "osm-raster",
                    minzoom: 0,
                    maxzoom: 19
                }
            ]
        },
        center: CONFIG.map.center,
        zoom: CONFIG.map.zoom,
        pitch: CONFIG.map.pitch,
        bearing: CONFIG.map.bearing,
        maxZoom: CONFIG.map.maxZoom,
        minZoom: CONFIG.map.minZoom,
        maxPitch: 70
    });

    map.addControl(new maplibregl.NavigationControl(), "top-right");
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 200 }), "bottom-right");

    state.map = map;
    return map;
}

// ── Layer Management ───────────────────────────────────────────────────────

/**
 * Add borehole data layers to the map.
 */
function addBoreholeLayers(map, geojson) {
    state.data = geojson;

    // Split features by layer group
    const groups = {};
    for (const [layerName, cfg] of Object.entries(CONFIG.layers)) {
        if (!groups[cfg.id]) {
            groups[cfg.id] = { features: [], color: cfg.color };
        }
    }

    for (const feature of geojson.features) {
        const layerName = feature.properties.layer || "unknown";
        const cfg = CONFIG.layers[layerName];
        if (cfg && groups[cfg.id]) {
            groups[cfg.id].features.push(feature);
        }
    }

    // Add each group as a source + layer
    for (const [groupId, group] of Object.entries(groups)) {
        const sourceId = `source-${groupId}`;
        const layerId = `layer-${groupId}`;

        map.addSource(sourceId, {
            type: "geojson",
            data: {
                type: "FeatureCollection",
                features: group.features
            }
        });

        // Circle layer for points
        map.addLayer({
            id: layerId,
            type: "circle",
            source: sourceId,
            paint: {
                "circle-radius": [
                    "interpolate", ["linear"], ["zoom"],
                    8, 2,
                    12, 5,
                    16, 10
                ],
                "circle-color": group.color,
                "circle-opacity": 0.8,
                "circle-stroke-width": 1,
                "circle-stroke-color": "#ffffff"
            }
        });

        // Interaction handlers
        map.on("mouseenter", layerId, () => {
            map.getCanvas().style.cursor = "pointer";
        });

        map.on("mouseleave", layerId, () => {
            map.getCanvas().style.cursor = "";
        });

        map.on("click", layerId, (e) => {
            if (e.features.length === 0) return;
            const feature = e.features[0];
            selectWell(feature, e.lngLat);
        });
    }

    updateStats();
}

/**
 * Add terrain data and 3D building layer.
 * Terrain uses AWS elevation tiles; buildings require a vector tile source.
 */
function addTerrainAnd3DBuildings(map) {
    // Add terrain elevation source
    try {
        map.addSource("terrain-source", {
            type: "raster-dem",
            tiles: [
                "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png"
            ],
            tileSize: 256,
            encoding: "terrarium",
            attribution: '<a href="https://github.com/tilezen/joerd">Tilezen Joerd</a>'
        });
        map.setTerrain({ source: "terrain-source", exaggeration: 1.5 });
    } catch (e) {
        console.warn("Could not enable terrain:", e.message);
    }

    // Add 3D buildings from OpenFreeMap vector tiles
    try {
        map.addSource("openmaptiles", {
            type: "vector",
            url: "https://tiles.openfreemap.org/planet"
        });
        map.addLayer({
            id: "3d-buildings",
            source: "openmaptiles",
            "source-layer": "building",
            type: "fill-extrusion",
            minzoom: 14,
            paint: {
                "fill-extrusion-color": "#ddd",
                "fill-extrusion-height": ["get", "render_height"],
                "fill-extrusion-base": ["get", "render_min_height"],
                "fill-extrusion-opacity": 0.6
            }
        });
    } catch (e) {
        console.warn("Could not add 3D buildings:", e.message);
    }
}

// ── Well Selection & Info ──────────────────────────────────────────────────

function selectWell(feature, lngLat) {
    state.selectedFeature = feature;
    const props = feature.properties;

    // Show popup on map
    if (state.popup) state.popup.remove();

    const layerName = props.layer || "Unknown";
    const cfg = CONFIG.layers[layerName] || { color: "#999", label: layerName };
    const title = props.brønnNr
        ? `Well #${props.brønnNr}`
        : (props.brønnParkNr ? `Well Park #${props.brønnParkNr}` : cfg.label);

    state.popup = new maplibregl.Popup({ offset: 15, maxWidth: "300px" })
        .setLngLat(lngLat)
        .setHTML(`
            <div class="popup-title">${title}</div>
            <span class="popup-type" style="background:${cfg.color}">${cfg.label}</span>
            <div class="popup-detail">
                ${props.boretLengde ? `Depth: ${props.boretLengde} m<br>` : ""}
                ${props.boreDato ? `Drilled: ${formatDate(props.boreDato)}<br>` : ""}
                ${props.oppdragstaker ? `Contractor: ${props.oppdragstaker}` : ""}
            </div>
        `)
        .addTo(state.map);

    // Update sidebar
    updateWellInfo(props, cfg);

    // Emit event for extensions
    emitEvent("wellSelected", { feature, lngLat });
}

function updateWellInfo(props, cfg) {
    const container = document.getElementById("well-info");
    const layerName = props.layer || "Unknown";
    const title = props.brønnNr
        ? `Well #${props.brønnNr}`
        : (props.brønnParkNr ? `Well Park #${props.brønnParkNr}` : cfg.label);

    let rows = "";
    // Show all non-null, non-empty properties
    const skipFields = new Set(["layer"]);
    for (const [key, value] of Object.entries(props)) {
        if (skipFields.has(key) || value === null || value === undefined || value === "") continue;
        const label = CONFIG.fieldLabels[key] || key;
        let displayValue = value;
        if (key.toLowerCase().includes("dato") || key.toLowerCase().includes("date")) {
            displayValue = formatDate(value);
        }
        rows += `<tr><td>${label}</td><td>${displayValue}</td></tr>`;
    }

    container.innerHTML = `
        <div class="well-detail">
            <div class="well-title">
                <span class="popup-type" style="background:${cfg.color}">${cfg.label}</span>
                ${title}
            </div>
            <table>${rows}</table>
        </div>
    `;
}

// ── Statistics ──────────────────────────────────────────────────────────────

function updateStats() {
    if (!state.data) return;
    const total = state.data.features.length;
    document.getElementById("total-count").textContent = total.toLocaleString();
    updateVisibleCount();
}

function updateVisibleCount() {
    if (!state.data) return;
    let visible = 0;
    for (const feature of state.data.features) {
        const layerName = feature.properties.layer || "unknown";
        const cfg = CONFIG.layers[layerName];
        if (cfg) {
            const checkbox = document.querySelector(`input[data-layer="${cfg.id}"]`);
            if (checkbox && checkbox.checked) visible++;
        }
    }
    document.getElementById("visible-count").textContent = visible.toLocaleString();
}

// ── UI Controls ─────────────────────────────────────────────────────────────

function setupLayerControls() {
    const checkboxes = document.querySelectorAll("#layer-controls input[type=checkbox]");
    checkboxes.forEach(cb => {
        cb.addEventListener("change", () => {
            const groupId = cb.dataset.layer;
            const layerId = `layer-${groupId}`;
            const visibility = cb.checked ? "visible" : "none";
            if (state.map.getLayer(layerId)) {
                state.map.setLayoutProperty(layerId, "visibility", visibility);
            }
            updateVisibleCount();
        });
    });
}

function setupSidebarToggle() {
    const sidebar = document.getElementById("sidebar");
    const toggle = document.getElementById("sidebar-toggle");
    toggle.addEventListener("click", () => {
        sidebar.classList.toggle("collapsed");
        toggle.classList.toggle("shifted");
    });
}

// ── Extension System ────────────────────────────────────────────────────────

/**
 * Register an extension that can react to application events.
 * Extensions should implement an `onEvent(eventName, data)` method.
 *
 * Example:
 *   GeothermalViz.registerExtension({
 *     name: "MyExtension",
 *     onEvent(event, data) {
 *       if (event === "wellSelected") {
 *         console.log("Well selected:", data.feature.properties);
 *       }
 *     }
 *   });
 */
function registerExtension(extension) {
    state.extensions.push(extension);
    console.log(`Extension registered: ${extension.name || "unnamed"}`);
}

function emitEvent(eventName, data) {
    for (const ext of state.extensions) {
        try {
            if (ext.onEvent) ext.onEvent(eventName, data);
        } catch (e) {
            console.error(`Extension error (${ext.name}):`, e);
        }
    }
}

/**
 * Connect to a Julia WebSocket server for real-time communication.
 * This allows Julia processes to push data updates and respond to UI events.
 */
function connectToJulia(wsUrl) {
    const ws = new WebSocket(wsUrl);
    ws.onopen = () => {
        console.log("Connected to Julia server via WebSocket");
        emitEvent("juliaConnected", { ws });
    };
    ws.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            emitEvent("juliaMessage", msg);
        } catch (e) {
            console.error("Failed to parse Julia message:", e);
        }
    };
    ws.onclose = () => {
        console.log("Julia WebSocket disconnected");
        emitEvent("juliaDisconnected", {});
    };
    return ws;
}

// ── Utilities ───────────────────────────────────────────────────────────────

function formatDate(dateStr) {
    if (!dateStr) return "";
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric" });
    } catch {
        return dateStr;
    }
}

function showLoading(message) {
    const overlay = document.createElement("div");
    overlay.id = "loading-overlay";
    overlay.className = "loading-overlay";
    overlay.innerHTML = `<div class="spinner"></div><div>${message}</div>`;
    document.body.appendChild(overlay);
}

function hideLoading() {
    const overlay = document.getElementById("loading-overlay");
    if (overlay) overlay.remove();
}

// ── Main Entry Point ────────────────────────────────────────────────────────

async function main() {
    showLoading("Loading borehole data…");

    try {
        // Initialize map
        const map = initMap();

        // Set up UI
        setupSidebarToggle();
        setupLayerControls();

        // Load data once map style is parsed (does not wait for tile loading)
        map.once("style.load", async () => {
            try {
                const geojson = await loadBoreholeData();
                addBoreholeLayers(map, geojson);
                addTerrainAnd3DBuildings(map);
                hideLoading();
                emitEvent("dataLoaded", { featureCount: geojson.features.length });
            } catch (err) {
                hideLoading();
                console.error("Failed to load borehole data:", err);
                document.getElementById("well-info").innerHTML =
                    `<p style="color:red">Error loading data. Run the Julia data processing script first:<br>
                    <code>julia --project=. scripts/process_data.jl</code></p>`;
            }
        });

    } catch (err) {
        hideLoading();
        console.error("Failed to initialize:", err);
    }
}

// Expose API for extensions
window.GeothermalViz = {
    state,
    registerExtension,
    connectToJulia,
    CONFIG
};

// Start the application
main();
