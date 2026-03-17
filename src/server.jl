"""
    start_server(; host="127.0.0.1", port=8080, data_dir="processed_data", web_dir="web")

Start an HTTP server that serves:
- Static web files (HTML/JS/CSS) from `web_dir`
- Processed GeoJSON data from `data_dir` under `/api/data/`
- Simulation setup and run endpoints under `/api/simulation/`

The server uses Fimbul.jl for geothermal simulations. No separate Julia
server is needed — everything runs in this single process.
"""
function start_server(; host::AbstractString="127.0.0.1", port::Int=8080,
                       data_dir::AbstractString="processed_data",
                       web_dir::AbstractString="web")
    if !isdir(data_dir)
        error("Data directory '$data_dir' not found. Run process_geodatabase() first.")
    end

    router = HTTP.Router()

    # API routes for data
    HTTP.register!(router, "GET", "/api/layers", function(req)
        files = filter(f -> endswith(f, ".geojson"), readdir(data_dir))
        layers = [replace(f, ".geojson" => "") for f in files]
        return HTTP.Response(200, ["Content-Type" => "application/json"],
                            body=JSON3.write(layers))
    end)

    HTTP.register!(router, "GET", "/api/data/{layer}", function(req)
        layer = HTTP.getparams(req)["layer"]
        filepath = joinpath(data_dir, "$(layer).geojson")
        if !isfile(filepath)
            return HTTP.Response(404, "Layer not found: $layer")
        end
        data = read(filepath, String)
        return HTTP.Response(200, ["Content-Type" => "application/geo+json",
                                    "Access-Control-Allow-Origin" => "*"],
                            body=data)
    end)

    # Health check
    HTTP.register!(router, "GET", "/api/health", function(req)
        return HTTP.Response(200, ["Content-Type" => "application/json"],
                            body=JSON3.write(Dict("status" => "ok", "version" => "0.1.0")))
    end)

    # Simulation: convert well metadata to Fimbul parameters
    HTTP.register!(router, "POST", "/api/simulation/setup", function(req)
        try
            body = JSON3.read(String(req.body))
            properties = Dict{String,Any}(string(k) => v for (k, v) in pairs(body))
            result = well_to_simulation_params(properties)
            return HTTP.Response(200, ["Content-Type" => "application/json",
                                       "Access-Control-Allow-Origin" => "*"],
                                body=JSON3.write(result))
        catch e
            return HTTP.Response(400, ["Content-Type" => "application/json"],
                                body=JSON3.write(Dict("error" => sprint(showerror, e))))
        end
    end)

    # Simulation: run Fimbul simulation with parameters
    HTTP.register!(router, "POST", "/api/simulation/run", function(req)
        try
            body = JSON3.read(String(req.body))
            setup = Dict{String,Any}(string(k) => v for (k, v) in pairs(body))
            # Convert nested objects
            if haskey(setup, "parameters")
                setup["parameters"] = Dict{String,Any}(
                    string(k) => v for (k, v) in pairs(setup["parameters"])
                )
            end
            errors = validate_simulation_params(setup)
            if !isempty(errors)
                return HTTP.Response(400, ["Content-Type" => "application/json",
                                           "Access-Control-Allow-Origin" => "*"],
                                    body=JSON3.write(Dict("status" => "error",
                                                          "errors" => [Dict("param" => e[1], "message" => e[2]) for e in errors])))
            end
            result = run_fimbul_simulation(setup)
            return HTTP.Response(200, ["Content-Type" => "application/json",
                                       "Access-Control-Allow-Origin" => "*"],
                                body=JSON3.write(result))
        catch e
            return HTTP.Response(500, ["Content-Type" => "application/json"],
                                body=JSON3.write(Dict("status" => "error",
                                                      "message" => sprint(showerror, e))))
        end
    end)

    # CORS preflight for simulation endpoints
    HTTP.register!(router, "OPTIONS", "/api/simulation/*", function(req)
        return HTTP.Response(204, [
            "Access-Control-Allow-Origin"  => "*",
            "Access-Control-Allow-Methods" => "POST, OPTIONS",
            "Access-Control-Allow-Headers" => "Content-Type",
        ])
    end)

    # Serve static files and handle all other routes
    function handle_request(req)
        # Try API router first; fall back to static files on 404
        try
            resp = router(req)
            if resp.status != 404
                return resp
            end
        catch e
            @error "Route handler error" exception=(e, catch_backtrace())
            return HTTP.Response(500, ["Content-Type" => "application/json"],
                                body=JSON3.write(Dict("error" => sprint(showerror, e))))
        end

        # Serve static files
        path = HTTP.URI(req.target).path
        if path == "/" || path == ""
            path = "/index.html"
        end

        filepath = joinpath(web_dir, lstrip(path, '/'))
        if isfile(filepath)
            content_type = get_content_type(filepath)
            data = read(filepath)
            return HTTP.Response(200, ["Content-Type" => content_type], body=data)
        end

        return HTTP.Response(404, "Not found: $path")
    end

    println("Starting GeothermalViz server at http://$host:$port")
    println("  Web interface: http://$host:$port/")
    println("  API endpoint:  http://$host:$port/api/layers")
    println("  Simulation:    http://$host:$port/api/simulation/setup")
    println("Press Ctrl+C to stop.")

    HTTP.serve(handle_request, host, port)
end

"""
    get_content_type(filepath)

Determine MIME type from file extension.
"""
function get_content_type(filepath::AbstractString)
    ext = lowercase(splitext(filepath)[2])
    types = Dict(
        ".html" => "text/html; charset=utf-8",
        ".js"   => "application/javascript; charset=utf-8",
        ".css"  => "text/css; charset=utf-8",
        ".json" => "application/json",
        ".geojson" => "application/geo+json",
        ".png"  => "image/png",
        ".svg"  => "image/svg+xml",
        ".ico"  => "image/x-icon",
    )
    return get(types, ext, "application/octet-stream")
end
