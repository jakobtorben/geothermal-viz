# GeothermalViz

Interactive map visualization of groundwater boreholes in the Oslo area with integrated geothermal simulation, built with [MapLibre GL JS](https://maplibre.org/), [Julia](https://julialang.org/), and [Fimbul.jl](https://github.com/sintefmath/Fimbul.jl).

![GeothermalViz Screenshot](https://github.com/user-attachments/assets/e9a328c7-6521-49fa-919a-dae9989d2397)

## Features

- **Data Processing**: Julia module reads ESRI File Geodatabase and exports GeoJSON with coordinate reprojection (UTM32 → WGS84)
- **Interactive Map**: MapLibre GL JS visualization with 20,384 boreholes across 7 layers
- **3D Terrain & Buildings**: Elevation data and 3D building extrusions
- **Well Selection**: Click any borehole to view detailed metadata in a popup and sidebar
- **Geothermal Simulation**: Select an energy well or well park and run Fimbul.jl simulations directly from the browser
- **Layer Controls**: Toggle visibility of different borehole types (energy wells, groundwater wells, well parks, etc.)

## Quick Start

### Prerequisites

- [Julia](https://julialang.org/downloads/) (≥ 1.10)

### 1. Install dependencies

```bash
julia --project=. -e 'using Pkg; Pkg.instantiate()'
```

This installs all Julia dependencies including Fimbul.jl for geothermal simulation.

### 2. Process the raw data

```bash
julia --project=. scripts/process_data.jl
```

This reads the ESRI geodatabase from `data/` and produces GeoJSON files in `processed_data/`.

### 3. Start the server

```bash
julia --project=. scripts/run_server.jl
```

Then open http://localhost:8080 in your browser.

The Julia server handles everything: static file serving, data APIs, and Fimbul.jl simulation. No separate processes are needed.

## Running a Simulation

1. Click on an **Energy Well** (EnergiBrønn) or **Well Park** (BrønnPark) on the map
2. Click **⚡ Setup Simulation** in the left sidebar
3. Review and adjust parameters in the right panel — values from well metadata are marked with 📊, defaults with ⚙️
4. Click **▶ Run Simulation** to execute the Fimbul.jl simulation
5. View results in the **Results** tab with time-series charts

Simulation is supported for:
- **EnergiBrønn** → AGS (Advanced Geothermal System) — closed-loop heat exchanger
- **BrønnPark** → BTES (Borehole Thermal Energy Storage) — seasonal heat storage

Other well types (GrunnvannBrønn, Sonderboring, etc.) are displayed on the map but cannot be simulated.

## Project Structure

```
├── data/                    # Raw ESRI File Geodatabase (UTM32/EPSG:25832)
├── processed_data/          # Generated GeoJSON files (WGS84/EPSG:4326)
├── src/
│   ├── GeothermalViz.jl     # Main Julia module
│   ├── data_processing.jl   # GDB → GeoJSON conversion with coordinate reprojection
│   ├── simulation.jl        # Well metadata → Fimbul.jl parameter mapping & simulation
│   └── server.jl            # HTTP server with API endpoints
├── scripts/
│   ├── process_data.jl      # Run data processing
│   └── run_server.jl        # Start the web server
├── web/
│   ├── index.html           # Main application page
│   ├── js/app.js            # MapLibre application with extension system
│   ├── js/simulation.js     # Simulation panel UI (calls Julia backend)
│   ├── css/style.css        # UI styling
│   └── vendor/              # Vendored MapLibre GL JS library
├── test/
│   └── runtests.jl          # Julia tests
└── Project.toml             # Julia project dependencies
```

## Architecture

The application uses a **single Julia server** architecture:

- **Backend (Julia)**: Handles data processing (ArchGDAL), HTTP serving (HTTP.jl), parameter mapping, and Fimbul.jl simulation. All simulation logic and parameter defaults live here — the frontend has no duplicated constants.
- **Frontend (JavaScript)**: MapLibre GL JS for map rendering, thin simulation panel that calls the Julia API. The JS layer handles only UI rendering and API calls.

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/layers` | GET | List available GeoJSON layers |
| `/api/data/{layer}` | GET | Get GeoJSON data for a layer |
| `/api/simulation/setup` | POST | Convert well properties to simulation parameters |
| `/api/simulation/run` | POST | Run a Fimbul.jl simulation |
| `/api/health` | GET | Health check |

## Data Layers

| Layer | Count | Description | Simulatable |
|-------|------:|-------------|:-----------:|
| EnergiBrønn | 14,033 | Energy wells (geothermal) | ✅ AGS |
| BrønnPark | 4,229 | Well parks (grouped installations) | ✅ BTES |
| GrunnvannBrønn | 2,088 | Groundwater wells | — |
| Sonderboring | 31 | Probe drillings | — |
| LGNBrønn | 1 | LGN monitoring well | — |
| GrunnvannOppkomme | 1 | Groundwater spring | — |
| LGNOmrådeRefPkt | 1 | LGN area reference point | — |

## Using from Julia

```julia
using GeothermalViz

# Process raw geodatabase
output_files = process_geodatabase("data/Grunnvannsborehull.gdb")

# Set up simulation parameters from well metadata
props = Dict("layer" => "EnergiBrønn", "boretLengde" => 250.0)
setup = well_to_simulation_params(props)

# Run simulation
result = run_fimbul_simulation(setup)

# Start server for web visualization
start_server(port=8080)
```

## Running Tests

```bash
julia --project=. -e 'using Pkg; Pkg.test()'
```

## License

MIT
