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
end
