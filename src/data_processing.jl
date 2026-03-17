using ArchGDAL
using GeoFormatTypes

const AG = ArchGDAL
const SOURCE_CRS = GeoFormatTypes.EPSG(25832)  # ETRS89 / UTM zone 32N
const TARGET_CRS = GeoFormatTypes.EPSG(4326)    # WGS84

"""
    process_geodatabase(gdb_path; output_dir="processed_data")

Read all layers from an ESRI File Geodatabase and export each as GeoJSON
with coordinates reprojected from UTM zone 32N (EPSG:25832) to WGS84 (EPSG:4326).

Returns a Dict mapping layer names to their output file paths.
"""
function process_geodatabase(gdb_path::AbstractString; output_dir::AbstractString="processed_data")
    mkpath(output_dir)
    dataset = AG.read(gdb_path)
    n_layers = AG.nlayer(dataset)
    output_files = Dict{String,String}()

    for i in 0:(n_layers - 1)
        layer = AG.getlayer(dataset, i)
        layer_name = AG.getname(layer)
        output_path = joinpath(output_dir, "$(layer_name).geojson")
        features = extract_layer_features(layer)
        geojson = build_feature_collection(features)
        open(output_path, "w") do io
            JSON3.write(io, geojson)
        end
        output_files[layer_name] = output_path
        println("Exported $(length(features)) features from '$layer_name' → $output_path")
    end

    # Create a combined file with all borehole layers
    combined_path = joinpath(output_dir, "all_boreholes.geojson")
    write_combined_geojson(dataset, combined_path)
    output_files["all_boreholes"] = combined_path

    return output_files
end

"""
    extract_layer_features(layer)

Extract all features from a layer, reprojecting coordinates to WGS84.
"""
function extract_layer_features(layer)
    features = Dict{String,Any}[]

    AG.resetreading!(layer)
    for feature in layer
        geom = AG.getgeom(feature)
        if geom === nothing || AG.isempty(geom)
            continue
        end

        # Reproject coordinates from UTM32 to WGS84
        x = AG.getx(geom, 0)
        y = AG.gety(geom, 0)
        coords = AG.reproject((x, y), SOURCE_CRS, TARGET_CRS)
        # EPSG:4326 returns (lat, lon); GeoJSON uses (lon, lat)
        lat, lon = coords[1], coords[2]

        props = extract_properties(feature, layer)

        feat = Dict{String,Any}(
            "type" => "Feature",
            "geometry" => Dict{String,Any}(
                "type" => "Point",
                "coordinates" => [lon, lat]
            ),
            "properties" => props
        )
        push!(features, feat)
    end

    return features
end

"""
    extract_properties(feature, layer)

Extract all attribute properties from a feature as a Dict.
"""
function extract_properties(feature, layer)
    props = Dict{String,Any}()
    layer_defn = AG.layerdefn(layer)
    n_fields = AG.nfield(feature)

    for j in 0:(n_fields - 1)
        field_defn = AG.getfielddefn(layer_defn, j)
        field_name = AG.getname(field_defn)
        if !AG.isfieldset(feature, j) || AG.isfieldnull(feature, j)
            props[field_name] = nothing
            continue
        end
        props[field_name] = try
            AG.getfield(feature, j)
        catch
            nothing
        end
    end

    return props
end

"""
    build_feature_collection(features)

Wrap a vector of GeoJSON features into a FeatureCollection.
"""
function build_feature_collection(features)
    return Dict{String,Any}(
        "type" => "FeatureCollection",
        "features" => features
    )
end

"""
    write_combined_geojson(dataset, output_path)

Combine key borehole layers into a single GeoJSON file with a `layer` property.
"""
function write_combined_geojson(dataset, output_path)
    all_features = Dict{String,Any}[]
    borehole_layers = ["EnergiBrønn", "GrunnvannBrønn", "Sonderboring", "BrønnPark",
                        "LGNBrønn", "GrunnvannOppkomme", "LGNOmrådeRefPkt"]

    for i in 0:(AG.nlayer(dataset) - 1)
        layer = AG.getlayer(dataset, i)
        layer_name = AG.getname(layer)
        if layer_name ∉ borehole_layers
            continue
        end
        features = extract_layer_features(layer)
        for feat in features
            feat["properties"]["layer"] = layer_name
        end
        append!(all_features, features)
    end

    geojson = build_feature_collection(all_features)
    open(output_path, "w") do io
        JSON3.write(io, geojson)
    end
    println("Combined $(length(all_features)) features → $output_path")
end

"""
    load_geojson(path)

Load a processed GeoJSON file and return the parsed data.
"""
function load_geojson(path::AbstractString)
    return JSON3.read(read(path, String))
end
