module GeothermalViz

using ArchGDAL
using JSON3
using HTTP

include("data_processing.jl")
include("server.jl")

export process_geodatabase, load_geojson, start_server, get_content_type

end # module
