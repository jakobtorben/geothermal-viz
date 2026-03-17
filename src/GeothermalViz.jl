module GeothermalViz

using ArchGDAL
using JSON3
using HTTP

include("data_processing.jl")
include("simulation.jl")
include("server.jl")

export process_geodatabase, load_geojson, start_server, get_content_type
export well_to_simulation_params, validate_simulation_params, run_fimbul_simulation
export SimCaseType, SIM_AGS, SIM_BTES, SIM_DOUBLET, select_case_type

end # module
