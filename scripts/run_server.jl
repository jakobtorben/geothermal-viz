#!/usr/bin/env julia
# Start the GeothermalViz server.
# Usage: julia --project=. scripts/run_server.jl [port]

using GeothermalViz

port = length(ARGS) >= 1 ? parse(Int, ARGS[1]) : 8080

start_server(;
    port=port,
    data_dir=joinpath(@__DIR__, "..", "processed_data"),
    web_dir=joinpath(@__DIR__, "..", "web")
)
