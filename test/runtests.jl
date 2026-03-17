using Test
using JSON3

# Test that the data processing module loads and functions exist
@testset "GeothermalViz" begin

    @testset "Module Loading" begin
        using GeothermalViz
        @test isdefined(GeothermalViz, :process_geodatabase)
        @test isdefined(GeothermalViz, :load_geojson)
        @test isdefined(GeothermalViz, :start_server)
    end

    @testset "Data Processing" begin
        using GeothermalViz

        gdb_path = joinpath(@__DIR__, "..", "data", "Grunnvannsborehull.gdb")
        output_dir = mktempdir()

        # Process the geodatabase
        output_files = process_geodatabase(gdb_path; output_dir=output_dir)

        # Check that output files were created
        @test haskey(output_files, "all_boreholes")
        @test haskey(output_files, "EnergiBrønn")
        @test haskey(output_files, "GrunnvannBrønn")
        @test haskey(output_files, "BrønnPark")

        # Check that the files exist and are valid GeoJSON
        for (name, path) in output_files
            @test isfile(path)
            data = JSON3.read(read(path, String))
            @test data.type == "FeatureCollection"
            @test haskey(data, :features)
        end

        # Check the combined file has features from multiple layers
        all_data = JSON3.read(read(output_files["all_boreholes"], String))
        @test length(all_data.features) > 0

        # Verify coordinates are in WGS84 range (longitude, latitude)
        for feat in all_data.features
            coords = feat.geometry.coordinates
            lon, lat = coords[1], coords[2]
            @test -180 <= lon <= 180
            @test -90 <= lat <= 90
            # Should be in Oslo area (approximately)
            @test 10.0 <= lon <= 11.5
            @test 59.5 <= lat <= 60.5
        end

        # Check that layer property is set in combined file
        layers_found = Set{String}()
        for feat in all_data.features
            if haskey(feat.properties, :layer)
                push!(layers_found, feat.properties.layer)
            end
        end
        @test "EnergiBrønn" in layers_found
        @test length(layers_found) >= 3

        # Check feature counts match expectations
        energi_data = JSON3.read(read(output_files["EnergiBrønn"], String))
        @test length(energi_data.features) > 10000  # Should be ~14033

        rm(output_dir; recursive=true)
    end

    @testset "Load GeoJSON" begin
        using GeothermalViz

        gdb_path = joinpath(@__DIR__, "..", "data", "Grunnvannsborehull.gdb")
        output_dir = mktempdir()
        process_geodatabase(gdb_path; output_dir=output_dir)

        data = load_geojson(joinpath(output_dir, "all_boreholes.geojson"))
        @test data.type == "FeatureCollection"
        @test length(data.features) > 0

        rm(output_dir; recursive=true)
    end

    @testset "Simulation Parameter Mapping" begin
        using GeothermalViz

        # Case type selection
        @test select_case_type("EnergiBrønn") == SIM_AGS
        @test select_case_type("BrønnPark") == SIM_BTES
        @test select_case_type("GrunnvannBrønn") == SIM_DOUBLET
        @test select_case_type("Sonderboring") == SIM_AGS
        @test select_case_type("Unknown") == SIM_AGS  # default fallback

        # Energy well → AGS with metadata extraction
        props = Dict("layer" => "EnergiBrønn", "brønnNr" => "12345",
                      "boretLengde" => 250.0, "diameterBorehull" => 139.0)
        result = well_to_simulation_params(props)
        @test result["case_type"] == "AGS"
        @test result["well_id"] == "Well #12345"
        @test result["parameters"]["well_depth"] == 250.0
        @test result["sources"]["well_depth"] == "data"
        @test result["parameters"]["borehole_diameter"] == 139.0
        @test result["sources"]["borehole_diameter"] == "data"
        # Defaults filled in for Oslo region
        @test result["parameters"]["surface_temperature"] == 7.0
        @test result["sources"]["surface_temperature"] == "default"
        @test haskey(result, "parameter_order")
        @test haskey(result, "metadata")

        # Well Park → BTES with num_wells from metadata
        props2 = Dict("layer" => "BrønnPark", "brønnParkNr" => "42",
                       "antallEnergiBrønner" => 24)
        result2 = well_to_simulation_params(props2)
        @test result2["case_type"] == "BTES"
        @test result2["well_id"] == "Well Park #42"
        @test result2["parameters"]["num_wells_btes"] == 24
        @test result2["sources"]["num_wells_btes"] == "data"

        # Groundwater Well → Doublet
        props3 = Dict("layer" => "GrunnvannBrønn", "brønnNr" => "99",
                       "boretLengde" => 180.0)
        result3 = well_to_simulation_params(props3)
        @test result3["case_type"] == "DOUBLET"
        @test result3["parameters"]["well_depth"] == 180.0

        # Missing metadata → all defaults
        props4 = Dict("layer" => "EnergiBrønn")
        result4 = well_to_simulation_params(props4)
        @test result4["case_type"] == "AGS"
        @test result4["sources"]["well_depth"] == "default"
    end

    @testset "Simulation Validation" begin
        using GeothermalViz

        # Valid parameters
        props = Dict("layer" => "EnergiBrønn", "boretLengde" => 200.0)
        setup = well_to_simulation_params(props)
        errors = validate_simulation_params(setup)
        @test isempty(errors)

        # Invalid: negative depth
        setup["parameters"]["well_depth"] = -10.0
        errors = validate_simulation_params(setup)
        @test !isempty(errors)
        @test any(e -> e[1] == "well_depth", errors)
    end

    @testset "Mock Simulation" begin
        using GeothermalViz

        # AGS mock
        props = Dict("layer" => "EnergiBrønn", "boretLengde" => 200.0)
        setup = well_to_simulation_params(props)
        result = run_fimbul_simulation(setup)
        @test result["status"] == "completed"
        @test result["num_steps"] > 0
        @test length(result["timestamps"]) == result["num_steps"]
        @test haskey(result["well_data"], "Producer")

        # BTES mock
        props2 = Dict("layer" => "BrønnPark", "brønnParkNr" => "1")
        setup2 = well_to_simulation_params(props2)
        result2 = run_fimbul_simulation(setup2)
        @test result2["status"] == "completed"
        @test haskey(result2["well_data"], "BTES Array")

        # Doublet mock
        props3 = Dict("layer" => "GrunnvannBrønn", "brønnNr" => "1")
        setup3 = well_to_simulation_params(props3)
        result3 = run_fimbul_simulation(setup3)
        @test result3["status"] == "completed"
        @test haskey(result3["well_data"], "Producer")
        @test haskey(result3["well_data"], "Injector")
    end
end
