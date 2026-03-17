module GeothermalViz

using ArchGDAL
using JSON3
using HTTP

include("data_processing.jl")
include("simulation.jl")
include("server.jl")

export process_geodatabase, load_geojson, start_server, get_content_type
export well_to_simulation_params, validate_simulation_params, run_fimbul_simulation
export SimCaseType, SIM_AGS, SIM_BTES, select_case_type, is_simulatable
export start_simulation_async, get_simulation_status

end # module
