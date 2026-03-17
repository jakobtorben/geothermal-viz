"""
    Simulation parameter mapping layer

Maps well metadata from the Norwegian borehole database to Fimbul.jl
geothermal simulation input parameters. Provides case type selection based
on well type, sensible defaults for the Oslo region, parameter validation,
and simulation orchestration.

Supported Fimbul.jl case types:
- AGS  (Advanced Geothermal System) — closed-loop single energy well
- BTES (Borehole Thermal Energy Storage) — well park arrays
- Doublet — paired injection/production wells

Typical workflow:
1. `well_to_simulation_params(properties)` — convert metadata to a parameter Dict
2. Edit parameters in the frontend
3. `run_fimbul_simulation(params)` — execute via Fimbul.jl (requires package)
"""

# ── Case type enum ───────────────────────────────────────────────────────────

"""Supported Fimbul.jl simulation case types."""
@enum SimCaseType SIM_AGS SIM_BTES SIM_DOUBLET

const CASE_TYPE_LABELS = Dict(
    SIM_AGS     => "Advanced Geothermal System (AGS)",
    SIM_BTES    => "Borehole Thermal Energy Storage (BTES)",
    SIM_DOUBLET => "Geothermal Doublet",
)

const CASE_TYPE_DESCRIPTIONS = Dict(
    SIM_AGS     => "Closed-loop heat exchanger in a single deep borehole. Suitable for individual energy wells.",
    SIM_BTES    => "Array of closely-spaced boreholes for seasonal heat storage. Suitable for well parks.",
    SIM_DOUBLET => "Conventional doublet with an injection and a production well in a layered reservoir.",
)

# ── Layer → Case type mapping ────────────────────────────────────────────────

"""
    select_case_type(layer_name) -> SimCaseType

Choose the most appropriate Fimbul simulation case type based on the
borehole layer (well type) from the Norwegian database.
"""
function select_case_type(layer_name::AbstractString)
    mapping = Dict(
        "EnergiBrønn"       => SIM_AGS,
        "GrunnvannBrønn"    => SIM_DOUBLET,
        "BrønnPark"         => SIM_BTES,
        "Sonderboring"      => SIM_AGS,
        "LGNBrønn"          => SIM_AGS,
        "GrunnvannOppkomme" => SIM_DOUBLET,
        "LGNOmrådeRefPkt"   => SIM_AGS,
    )
    return get(mapping, layer_name, SIM_AGS)
end

# ── Oslo-region defaults ─────────────────────────────────────────────────────

"""Sensible default parameters for the Oslo geological region."""
const OSLO_DEFAULTS = Dict{String,Any}(
    "surface_temperature"       => 7.0,     # °C — Oslo annual mean
    "geothermal_gradient"       => 0.025,   # K/m — typical Norwegian basement rock
    "rock_thermal_conductivity" => 3.0,     # W/(m·K) — Oslo gneiss/granite
    "rock_heat_capacity"        => 850.0,   # J/(kg·K)
    "rock_density"              => 2650.0,  # kg/m³ — crystalline rock
    "porosity"                  => 0.01,    # fractional — tight crystalline rock
    "permeability"              => 0.1,     # mD — low-permeability basement
)

# ── Parameter metadata ───────────────────────────────────────────────────────

"""
Metadata describing each simulation parameter.
Keys: label, unit, min, max, step, tooltip, group.
"""
const PARAM_METADATA = Dict{String,Dict{String,Any}}(
    # Well / geometry
    "well_depth"                => Dict{String,Any}("label" => "Well depth",                "unit" => "m",       "min" => 10,    "max" => 8000,  "step" => 10,    "tooltip" => "Total drilled depth of the well",                           "group" => "well"),
    "borehole_diameter"         => Dict{String,Any}("label" => "Borehole diameter",         "unit" => "mm",      "min" => 50,    "max" => 500,   "step" => 1,     "tooltip" => "Diameter of the borehole",                                   "group" => "well"),
    # Rock properties
    "surface_temperature"       => Dict{String,Any}("label" => "Surface temperature",       "unit" => "°C",      "min" => -10,   "max" => 40,    "step" => 0.5,   "tooltip" => "Mean annual temperature at the surface",                     "group" => "rock"),
    "geothermal_gradient"       => Dict{String,Any}("label" => "Geothermal gradient",       "unit" => "K/m",     "min" => 0.01,  "max" => 0.10,  "step" => 0.005, "tooltip" => "Rate of temperature increase with depth",                    "group" => "rock"),
    "rock_thermal_conductivity" => Dict{String,Any}("label" => "Thermal conductivity",      "unit" => "W/(m·K)", "min" => 0.5,   "max" => 10.0,  "step" => 0.1,   "tooltip" => "Thermal conductivity of the surrounding rock",               "group" => "rock"),
    "rock_heat_capacity"        => Dict{String,Any}("label" => "Rock heat capacity",        "unit" => "J/(kg·K)","min" => 100,   "max" => 2000,  "step" => 50,    "tooltip" => "Specific heat capacity of the rock matrix",                  "group" => "rock"),
    "porosity"                  => Dict{String,Any}("label" => "Porosity",                  "unit" => "–",       "min" => 0.001, "max" => 0.5,   "step" => 0.01,  "tooltip" => "Rock porosity (volume fraction)",                            "group" => "rock"),
    "permeability"              => Dict{String,Any}("label" => "Permeability",              "unit" => "mD",      "min" => 0.001, "max" => 5000,  "step" => 1,     "tooltip" => "Rock permeability in millidarcys",                           "group" => "rock"),
    # Operation
    "temperature_inj"           => Dict{String,Any}("label" => "Injection temperature",     "unit" => "°C",      "min" => 5,     "max" => 100,   "step" => 1,     "tooltip" => "Temperature of injected fluid",                              "group" => "operation"),
    "flow_rate"                 => Dict{String,Any}("label" => "Flow rate",                 "unit" => "m³/h",    "min" => 1,     "max" => 500,   "step" => 1,     "tooltip" => "Volumetric flow rate",                                       "group" => "operation"),
    "num_years"                 => Dict{String,Any}("label" => "Simulation years",          "unit" => "yr",      "min" => 1,     "max" => 500,   "step" => 1,     "tooltip" => "Duration of the simulation",                                 "group" => "simulation"),
    # BTES-specific
    "num_wells_btes"            => Dict{String,Any}("label" => "Number of wells",           "unit" => "–",       "min" => 4,     "max" => 200,   "step" => 1,     "tooltip" => "Total number of boreholes in the BTES array",                "group" => "btes"),
    "num_sectors"               => Dict{String,Any}("label" => "Number of sectors",         "unit" => "–",       "min" => 1,     "max" => 20,    "step" => 1,     "tooltip" => "Number of sectors the wells are divided into",               "group" => "btes"),
    "well_spacing"              => Dict{String,Any}("label" => "Well spacing",              "unit" => "m",       "min" => 2,     "max" => 20,    "step" => 0.5,   "tooltip" => "Horizontal spacing between adjacent boreholes",              "group" => "btes"),
    "temperature_charge"        => Dict{String,Any}("label" => "Charge temperature",        "unit" => "°C",      "min" => 30,    "max" => 150,   "step" => 1,     "tooltip" => "Injection temperature during charging",                      "group" => "btes"),
    "temperature_discharge"     => Dict{String,Any}("label" => "Discharge temperature",     "unit" => "°C",      "min" => 5,     "max" => 50,    "step" => 1,     "tooltip" => "Injection temperature during discharging",                   "group" => "btes"),
    "rate_charge"               => Dict{String,Any}("label" => "Charge rate",               "unit" => "L/s",     "min" => 0.1,   "max" => 50,    "step" => 0.1,   "tooltip" => "Injection rate during charging per sector",                   "group" => "btes"),
    # Doublet-specific
    "spacing_top"               => Dict{String,Any}("label" => "Surface well spacing",      "unit" => "m",       "min" => 10,    "max" => 500,   "step" => 10,    "tooltip" => "Horizontal distance between wells at the surface",           "group" => "doublet"),
    "spacing_bottom"            => Dict{String,Any}("label" => "Reservoir well spacing",    "unit" => "m",       "min" => 100,   "max" => 5000,  "step" => 50,    "tooltip" => "Horizontal distance between wells in the reservoir",         "group" => "doublet"),
    "depth_deviation"           => Dict{String,Any}("label" => "Deviation depth",           "unit" => "m",       "min" => 100,   "max" => 5000,  "step" => 50,    "tooltip" => "Depth at which the well starts to deviate",                  "group" => "doublet"),
)

"""Parameter keys used for each case type, in display order."""
const CASE_PARAMS = Dict{SimCaseType, Vector{String}}(
    SIM_AGS => [
        "well_depth", "borehole_diameter",
        "surface_temperature", "geothermal_gradient",
        "rock_thermal_conductivity", "rock_heat_capacity",
        "porosity", "permeability",
        "temperature_inj", "flow_rate", "num_years",
    ],
    SIM_BTES => [
        "well_depth", "num_wells_btes", "num_sectors", "well_spacing",
        "surface_temperature", "geothermal_gradient",
        "rock_thermal_conductivity", "rock_heat_capacity",
        "temperature_charge", "temperature_discharge",
        "rate_charge", "num_years",
    ],
    SIM_DOUBLET => [
        "well_depth", "borehole_diameter",
        "spacing_top", "spacing_bottom", "depth_deviation",
        "surface_temperature", "geothermal_gradient",
        "rock_thermal_conductivity", "rock_heat_capacity",
        "porosity", "permeability",
        "temperature_inj", "flow_rate", "num_years",
    ],
)

# ── Well metadata → simulation parameters ────────────────────────────────────

"""
    well_to_simulation_params(properties::Dict) -> Dict{String,Any}

Convert well metadata (GeoJSON properties) from the Norwegian borehole
database into Fimbul.jl simulation parameters.  Properties that are not
available in the dataset are filled with sensible Oslo-region defaults.

Returns a Dict with keys:
- `"case_type"` — string label ("AGS", "BTES", "DOUBLET")
- `"case_label"` — human-readable case name
- `"case_description"` — short description
- `"well_id"` — well identifier from the metadata
- `"parameters"` — Dict of simulation parameter name → value
- `"parameter_order"` — ordered list of parameter keys for this case
- `"metadata"` — per-parameter metadata (label, unit, min, max, …)
- `"sources"` — Dict indicating whether each value came from "data" or "default"
"""
function well_to_simulation_params(properties::AbstractDict)
    # Determine well type and case
    layer_name = get(properties, "layer", "EnergiBrønn")
    case_type = select_case_type(layer_name isa Nothing ? "EnergiBrønn" : string(layer_name))
    case_key = case_type == SIM_AGS ? "AGS" : case_type == SIM_BTES ? "BTES" : "DOUBLET"

    # Build well identifier
    well_id = _well_identifier(properties)

    # Extract known values from metadata
    depth = _numeric(get(properties, "boretLengde", nothing))
    diameter = _numeric(get(properties, "diameterBorehull", nothing))

    # BTES fields
    n_energy_wells = _numeric(get(properties, "antallEnergiBrønner", nothing))
    heating_power  = _numeric(get(properties, "brønnpVEffekt", nothing))

    # Build parameter dict with source tracking
    params  = Dict{String,Any}()
    sources = Dict{String,String}()
    param_keys = CASE_PARAMS[case_type]

    for key in param_keys
        val, src = _resolve_param(key, depth, diameter, n_energy_wells, heating_power)
        params[key]  = val
        sources[key] = src
    end

    # Collect metadata for the parameters used
    meta = Dict{String,Any}()
    for key in param_keys
        if haskey(PARAM_METADATA, key)
            meta[key] = PARAM_METADATA[key]
        end
    end

    return Dict{String,Any}(
        "case_type"        => case_key,
        "case_label"       => CASE_TYPE_LABELS[case_type],
        "case_description" => CASE_TYPE_DESCRIPTIONS[case_type],
        "well_id"          => well_id,
        "parameters"       => params,
        "parameter_order"  => param_keys,
        "metadata"         => meta,
        "sources"          => sources,
    )
end

# ── Parameter resolution helpers ─────────────────────────────────────────────

"""Resolve a single parameter from well metadata or defaults."""
function _resolve_param(key, depth, diameter, n_energy_wells, heating_power)
    # Well geometry — from data when available
    if key == "well_depth" && depth !== nothing
        return (depth, "data")
    end
    if key == "borehole_diameter" && diameter !== nothing
        return (diameter, "data")
    end
    # BTES — derive from well park metadata
    if key == "num_wells_btes" && n_energy_wells !== nothing
        return (max(4, round(Int, n_energy_wells)), "data")
    end
    if key == "flow_rate" && heating_power !== nothing
        # Rough estimate: Q ≈ P / (ρ·cp·ΔT), assume ΔT=5K, ρ·cp≈4.18e6
        rate_m3h = heating_power / (4.18e6 * 5.0) * 3600.0
        return (max(1.0, round(rate_m3h; digits=1)), "data")
    end

    # Oslo-region defaults
    if haskey(OSLO_DEFAULTS, key)
        return (OSLO_DEFAULTS[key], "default")
    end

    # Case-type-specific defaults
    defaults = Dict{String,Any}(
        "well_depth"            => 200.0,
        "borehole_diameter"     => 140.0,
        "temperature_inj"       => 25.0,
        "flow_rate"             => 25.0,
        "num_years"             => 25,
        # BTES
        "num_wells_btes"        => 48,
        "num_sectors"           => 6,
        "well_spacing"          => 5.0,
        "temperature_charge"    => 90.0,
        "temperature_discharge" => 10.0,
        "rate_charge"           => 0.5,
        # Doublet
        "spacing_top"           => 100.0,
        "spacing_bottom"        => 1000.0,
        "depth_deviation"       => 800.0,
    )

    val = get(defaults, key, 0.0)
    return (val, "default")
end

"""Convert a value to Float64 if possible, else return nothing."""
function _numeric(val)
    val === nothing && return nothing
    val isa Number  && return Float64(val)
    try
        return parse(Float64, string(val))
    catch
        return nothing
    end
end

"""Build a human-readable well identifier from metadata."""
function _well_identifier(props)
    nr = get(props, "brønnNr", nothing)
    nr !== nothing && return "Well #$(nr)"
    pk = get(props, "brønnParkNr", nothing)
    pk !== nothing && return "Well Park #$(pk)"
    return "Selected Well"
end

# ── Validation ───────────────────────────────────────────────────────────────

"""
    validate_simulation_params(params::Dict) -> Vector{Tuple{String,String}}

Validate simulation parameters against their metadata ranges.
Returns a list of `(param_key, error_message)` tuples; empty if valid.
"""
function validate_simulation_params(params::AbstractDict)
    errors = Tuple{String,String}[]
    parameters = get(params, "parameters", params)

    for (key, val) in parameters
        meta = get(PARAM_METADATA, key, nothing)
        meta === nothing && continue
        v = _numeric(val)
        v === nothing && continue
        mn = get(meta, "min", -Inf)
        mx = get(meta, "max",  Inf)
        if v < mn
            push!(errors, (key, "$(meta["label"]) must be ≥ $mn $(meta["unit"])"))
        elseif v > mx
            push!(errors, (key, "$(meta["label"]) must be ≤ $mx $(meta["unit"])"))
        end
    end
    return errors
end

# ── Simulation runner ────────────────────────────────────────────────────────

"""
    run_fimbul_simulation(setup::Dict) -> Dict{String,Any}

Execute a Fimbul.jl simulation using the prepared parameter set.

Requires `Fimbul` to be installed and loaded. If Fimbul is not available,
returns a mock result with representative data for UI development.
"""
function run_fimbul_simulation(setup::AbstractDict)
    case_type = get(setup, "case_type", "AGS")
    params    = setup["parameters"]

    # Check whether Fimbul is available
    fimbul_available = isdefined(Main, :Fimbul)

    if fimbul_available
        return _run_fimbul_live(case_type, params)
    else
        return _run_mock_simulation(case_type, params)
    end
end

"""Run simulation using Fimbul.jl (requires the package to be loaded)."""
function _run_fimbul_live(case_type, params)
    try
        Fimbul = Main.Fimbul

        if case_type == "AGS"
            case = Fimbul.ags(;
                porosity                  = params["porosity"],
                permeability              = params["permeability"] * 1e-3 * Fimbul.darcy,
                rock_thermal_conductivity = params["rock_thermal_conductivity"] * Fimbul.watt / (Fimbul.meter * Fimbul.Kelvin),
                rock_heat_capacity        = params["rock_heat_capacity"] * Fimbul.joule / (Fimbul.kilogram * Fimbul.Kelvin),
                temperature_surface       = Fimbul.convert_to_si(params["surface_temperature"], :Celsius),
                thermal_gradient          = params["geothermal_gradient"] * Fimbul.Kelvin / Fimbul.meter,
                rate                      = params["flow_rate"] * Fimbul.meter^3 / Fimbul.hour,
                temperature_inj           = Fimbul.convert_to_si(params["temperature_inj"], :Celsius),
                num_years                 = params["num_years"],
            )
        elseif case_type == "BTES"
            case = Fimbul.btes(;
                num_wells            = round(Int, params["num_wells_btes"]),
                num_sectors          = round(Int, params["num_sectors"]),
                well_spacing         = params["well_spacing"],
                temperature_charge   = Fimbul.convert_to_si(params["temperature_charge"], :Celsius),
                temperature_discharge = Fimbul.convert_to_si(params["temperature_discharge"], :Celsius),
                rate_charge          = params["rate_charge"] * Fimbul.litre / Fimbul.second,
                temperature_surface  = Fimbul.convert_to_si(params["surface_temperature"], :Celsius),
                geothermal_gradient  = params["geothermal_gradient"] * Fimbul.Kelvin / Fimbul.meter,
                num_years            = round(Int, params["num_years"]),
            )
        elseif case_type == "DOUBLET"
            case = Fimbul.geothermal_doublet(;
                spacing_top         = params["spacing_top"],
                spacing_bottom      = params["spacing_bottom"],
                depth_1             = params["depth_deviation"],
                depth_2             = params["well_depth"],
                temperature_inj     = Fimbul.convert_to_si(params["temperature_inj"], :Celsius),
                rate                = params["flow_rate"] * Fimbul.meter^3 / Fimbul.hour,
                temperature_surface = Fimbul.convert_to_si(params["surface_temperature"], :Celsius),
                num_years           = round(Int, params["num_years"]),
            )
        else
            return Dict("status" => "error", "message" => "Unknown case type: $case_type")
        end

        result = Fimbul.simulate_reservoir(case[1:5])
        ws, states, t = result
        well_data = Dict{String,Any}()
        for (wname, wdata) in pairs(ws)
            well_data[string(wname)] = Dict{String,Any}(
                string(k) => v isa AbstractVector ? collect(Float64, v) : v
                for (k, v) in pairs(wdata)
            )
        end

        return Dict{String,Any}(
            "status"     => "completed",
            "message"    => "Simulation completed successfully.",
            "well_data"  => well_data,
            "timestamps" => collect(Float64, t),
            "num_steps"  => length(states),
        )
    catch e
        return Dict{String,Any}(
            "status"  => "error",
            "message" => "Simulation failed: $(sprint(showerror, e))",
        )
    end
end

"""Generate mock simulation results for UI development."""
function _run_mock_simulation(case_type, params)
    n_years = round(Int, get(params, "num_years", 25))
    n_steps = n_years * 12  # monthly output
    dt = range(0, n_years * 365.25; length=n_steps)
    timestamps = collect(Float64, dt)

    depth = get(params, "well_depth", 200.0)
    T_surface = get(params, "surface_temperature", 7.0)
    gradient = get(params, "geothermal_gradient", 0.025)
    T_bottom = T_surface + gradient * depth

    # Produce plausible temperature curves
    T_prod = [T_bottom - 0.3 * log(1 + t / 365.0) + 0.5 * sin(2π * t / 365.25) for t in timestamps]
    T_inj  = fill(get(params, "temperature_inj", 25.0), n_steps)
    rate   = fill(get(params, "flow_rate", 25.0), n_steps)

    well_data = Dict{String,Any}()
    if case_type == "DOUBLET"
        well_data["Producer"] = Dict{String,Any}(
            "Temperature [°C]" => T_prod,
            "Rate [m³/h]"      => .-rate,
        )
        well_data["Injector"] = Dict{String,Any}(
            "Temperature [°C]" => T_inj,
            "Rate [m³/h]"      => rate,
        )
    elseif case_type == "AGS"
        well_data["Producer"] = Dict{String,Any}(
            "Temperature [°C]" => T_prod,
            "Rate [m³/h]"      => rate,
        )
    else  # BTES
        T_charge = fill(get(params, "temperature_charge", 90.0), n_steps)
        T_out = [T_surface + (get(params, "temperature_charge", 90.0) - T_surface) * (1 - exp(-i / (n_steps / 4))) * (0.5 + 0.5 * sin(2π * t / 365.25)) for (i, t) in enumerate(timestamps)]
        well_data["BTES Array"] = Dict{String,Any}(
            "Temperature [°C]" => T_out,
            "Rate [L/s]"       => fill(get(params, "rate_charge", 0.5), n_steps),
        )
    end

    return Dict{String,Any}(
        "status"     => "completed",
        "message"    => "Mock simulation completed (Fimbul.jl not loaded). Results are illustrative.",
        "well_data"  => well_data,
        "timestamps" => timestamps,
        "num_steps"  => n_steps,
    )
end
