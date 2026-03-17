# GeothermalViz

Interactive map visualization of groundwater boreholes in the Oslo area, built with [MapLibre GL JS](https://maplibre.org/) and [Julia](https://julialang.org/).

![GeothermalViz Screenshot](https://github.com/user-attachments/assets/e9a328c7-6521-49fa-919a-dae9989d2397)

## Features

- **Data Processing**: Julia module reads ESRI File Geodatabase and exports GeoJSON with coordinate reprojection (UTM32 → WGS84)
- **Interactive Map**: MapLibre GL JS visualization with 20,384 boreholes across 7 layers
- **3D Terrain & Buildings**: Elevation data and 3D building extrusions
- **Well Selection**: Click any borehole to view detailed metadata in a popup and sidebar
- **Layer Controls**: Toggle visibility of different borehole types (energy wells, groundwater wells, well parks, etc.)
- **Extensible Architecture**: Extension system and Julia WebSocket support for connecting additional processes

## Quick Start

### 1. Process the raw data

```bash
julia --project=. -e 'using Pkg; Pkg.instantiate()'
julia --project=. scripts/process_data.jl
```

This reads the ESRI geodatabase from `data/` and produces GeoJSON files in `processed_data/`.

### 2. Start the server

**Option A — Julia server** (recommended for development with Julia integration):
```bash
julia --project=. scripts/run_server.jl
```
Then open http://localhost:8080 in your browser.

**Option B — Any static file server** (for quick viewing):
```bash
# Copy processed data into the web directory
cp -r processed_data web/processed_data
cd web && python3 -m http.server 8080
```

## Project Structure

```
├── data/                    # Raw ESRI File Geodatabase (UTM32/EPSG:25832)
├── processed_data/          # Generated GeoJSON files (WGS84/EPSG:4326)
├── src/
│   ├── GeothermalViz.jl     # Main Julia module
│   ├── data_processing.jl   # GDB → GeoJSON conversion with coordinate reprojection
│   └── server.jl            # HTTP server with API endpoints
├── scripts/
│   ├── process_data.jl      # Run data processing
│   └── run_server.jl        # Start the web server
├── web/
│   ├── index.html           # Main application page
│   ├── js/app.js            # MapLibre application with extension system
│   ├── css/style.css         # UI styling
│   └── vendor/              # Vendored MapLibre GL JS library
├── test/
│   └── runtests.jl          # Julia tests
└── Project.toml             # Julia project dependencies
```

## Data Layers

| Layer | Count | Description |
|-------|------:|-------------|
| EnergiBrønn | 14,033 | Energy wells (geothermal) |
| BrønnPark | 4,229 | Well parks (grouped installations) |
| GrunnvannBrønn | 2,088 | Groundwater wells |
| Sonderboring | 31 | Probe drillings |
| LGNBrønn | 1 | LGN monitoring well |
| GrunnvannOppkomme | 1 | Groundwater spring |
| LGNOmrådeRefPkt | 1 | LGN area reference point |

## Using from Julia

```julia
using GeothermalViz

# Process raw geodatabase
output_files = process_geodatabase("data/Grunnvannsborehull.gdb")

# Load processed data
data = load_geojson("processed_data/all_boreholes.geojson")

# Start server for web visualization
start_server(port=8080)
```

## Extending the Application

### JavaScript Extensions

Register extensions to react to map events:

```javascript
GeothermalViz.registerExtension({
    name: "MyAnalysis",
    onEvent(event, data) {
        if (event === "wellSelected") {
            console.log("Selected:", data.feature.properties);
        }
    }
});
```

### Julia WebSocket Connection

Connect the frontend to a Julia process for real-time data:

```javascript
GeothermalViz.connectToJulia("ws://localhost:8080/ws");
```

## Running Tests

```bash
julia --project=. test/runtests.jl
```

## License

MIT
