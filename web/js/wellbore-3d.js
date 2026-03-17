/**
 * GeothermalViz – 3D Wellbore Visualization
 *
 * MapLibre custom layer that renders wellbore and geological layers as
 * stacked 3D grid cells above the well point on the map.
 *
 * Features:
 * - Stacked segments coloured by geological layer
 * - Animated "rise-up" effect when simulation setup is triggered
 * - Hexagonal layout for wellpark (BTES) with one column per well
 * - Real-time updates when grid parameters change in the setup form
 */
(function () {
    "use strict";

    // ── Constants & Configuration ──────────────────────────────────────────

    const LAYER_ID = "wellbore-3d";

    /** Geological layers from surface (bottom of column) to deep (top). */
    const GEO_LAYERS = [
        { name: "Soil / Quaternary",     fraction: 0.05, color: [0.63, 0.52, 0.32] },
        { name: "Marine Clay",           fraction: 0.07, color: [0.72, 0.59, 0.42] },
        { name: "Glacial Till",          fraction: 0.08, color: [0.56, 0.53, 0.47] },
        { name: "Weathered Bedrock",     fraction: 0.08, color: [0.51, 0.48, 0.45] },
        { name: "Fractured Gneiss",      fraction: 0.15, color: [0.44, 0.48, 0.52] },
        { name: "Precambrian Gneiss",    fraction: 0.25, color: [0.38, 0.42, 0.46] },
        { name: "Granite / Granodiorite",fraction: 0.17, color: [0.33, 0.37, 0.40] },
        { name: "Deep Crystalline",      fraction: 0.15, color: [0.24, 0.30, 0.35] },
    ];

    const SEGMENT_GAP    = 3;       // metres between segments (grid effect)
    const HEIGHT_SCALE   = 1.0;     // vertical scale multiplier
    const WELL_HALF      = 15;      // half-width of single-well column (m)
    const PARK_WELL_HALF = 6;       // half-width per well in a wellpark (m)
    const ANIM_DURATION  = 1200;    // rise animation duration (ms)
    const ANIM_DELAY     = 500;     // delay before animation starts (ms)
    const FLY_ZOOM       = 15.5;
    const FLY_PITCH      = 60;

    // ── Shader sources ─────────────────────────────────────────────────────

    const VS_SRC = `
        attribute vec3 a_pos;
        attribute vec4 a_color;
        uniform mat4 u_matrix;
        varying vec4 v_color;
        void main() {
            gl_Position = u_matrix * vec4(a_pos, 1.0);
            v_color = a_color;
        }
    `;

    const FS_SRC = `
        precision mediump float;
        varying vec4 v_color;
        void main() {
            gl_FragColor = v_color;
        }
    `;

    // ── WebGL helpers ──────────────────────────────────────────────────────

    function compileShader(gl, type, src) {
        const s = gl.createShader(type);
        gl.shaderSource(s, src);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.error("Shader compile error:", gl.getShaderInfoLog(s));
            gl.deleteShader(s);
            return null;
        }
        return s;
    }

    function linkProgram(gl, vsSrc, fsSrc) {
        const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
        const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
        if (!vs || !fs) return null;
        const p = gl.createProgram();
        gl.attachShader(p, vs);
        gl.attachShader(p, fs);
        gl.linkProgram(p);
        if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
            console.error("Program link error:", gl.getProgramInfoLog(p));
            gl.deleteProgram(p);
            return null;
        }
        return p;
    }

    // ── Geometry helpers ───────────────────────────────────────────────────

    /**
     * Hexagonal layout positions for a wellpark.
     * Returns array of { dx, dy } offsets in metres.
     */
    function hexLayout(count, spacing) {
        if (count <= 0) return [];
        const out = [{ dx: 0, dy: 0 }];
        let ring = 1;
        while (out.length < count) {
            for (let side = 0; side < 6; side++) {
                for (let j = 0; j < ring; j++) {
                    if (out.length >= count) return out;
                    const a0 = side * Math.PI / 3;
                    const a1 = ((side + 1) % 6) * Math.PI / 3;
                    const t  = ring > 1 ? j / ring : 0;
                    out.push({
                        dx: ring * spacing * Math.cos(a0) + t * ring * spacing * (Math.cos(a1) - Math.cos(a0)),
                        dy: ring * spacing * Math.sin(a0) + t * ring * spacing * (Math.sin(a1) - Math.sin(a0)),
                    });
                }
            }
            ring++;
        }
        return out;
    }

    /** Push a single vertex (3 pos + 4 colour/alpha) into a plain array. */
    function v(arr, x, y, z, r, g, b, a) {
        arr.push(x, y, z, r, g, b, a);
    }

    /**
     * Append a box (36 verts) to `arr`.
     * (x0,y0,z0)–(x1,y1,z1) are opposite corners in mercator space.
     * Face-dependent shade simulates directional lighting.
     */
    function addBox(arr, x0, y0, z0, x1, y1, z1, cr, cg, cb) {
        const S = { top: 1.0, front: 0.82, right: 0.73, back: 0.62, left: 0.55, bot: 0.40 };
        const A = 0.92;
        const shade = (s) => [cr * s, cg * s, cb * s];

        // top (+z)
        let c = shade(S.top);
        v(arr,x0,y0,z1,c[0],c[1],c[2],A); v(arr,x1,y0,z1,c[0],c[1],c[2],A); v(arr,x1,y1,z1,c[0],c[1],c[2],A);
        v(arr,x0,y0,z1,c[0],c[1],c[2],A); v(arr,x1,y1,z1,c[0],c[1],c[2],A); v(arr,x0,y1,z1,c[0],c[1],c[2],A);
        // bottom (-z)
        c = shade(S.bot);
        v(arr,x0,y1,z0,c[0],c[1],c[2],A); v(arr,x1,y1,z0,c[0],c[1],c[2],A); v(arr,x1,y0,z0,c[0],c[1],c[2],A);
        v(arr,x0,y1,z0,c[0],c[1],c[2],A); v(arr,x1,y0,z0,c[0],c[1],c[2],A); v(arr,x0,y0,z0,c[0],c[1],c[2],A);
        // front (-y)
        c = shade(S.front);
        v(arr,x0,y0,z0,c[0],c[1],c[2],A); v(arr,x1,y0,z0,c[0],c[1],c[2],A); v(arr,x1,y0,z1,c[0],c[1],c[2],A);
        v(arr,x0,y0,z0,c[0],c[1],c[2],A); v(arr,x1,y0,z1,c[0],c[1],c[2],A); v(arr,x0,y0,z1,c[0],c[1],c[2],A);
        // back (+y)
        c = shade(S.back);
        v(arr,x1,y1,z0,c[0],c[1],c[2],A); v(arr,x0,y1,z0,c[0],c[1],c[2],A); v(arr,x0,y1,z1,c[0],c[1],c[2],A);
        v(arr,x1,y1,z0,c[0],c[1],c[2],A); v(arr,x0,y1,z1,c[0],c[1],c[2],A); v(arr,x1,y1,z1,c[0],c[1],c[2],A);
        // right (+x)
        c = shade(S.right);
        v(arr,x1,y0,z0,c[0],c[1],c[2],A); v(arr,x1,y1,z0,c[0],c[1],c[2],A); v(arr,x1,y1,z1,c[0],c[1],c[2],A);
        v(arr,x1,y0,z0,c[0],c[1],c[2],A); v(arr,x1,y1,z1,c[0],c[1],c[2],A); v(arr,x1,y0,z1,c[0],c[1],c[2],A);
        // left (-x)
        c = shade(S.left);
        v(arr,x0,y1,z0,c[0],c[1],c[2],A); v(arr,x0,y0,z0,c[0],c[1],c[2],A); v(arr,x0,y0,z1,c[0],c[1],c[2],A);
        v(arr,x0,y1,z0,c[0],c[1],c[2],A); v(arr,x0,y0,z1,c[0],c[1],c[2],A); v(arr,x0,y1,z1,c[0],c[1],c[2],A);
    }

    /**
     * Build a Float32Array of vertex data for every segment of every well.
     *
     * @param {MercatorCoordinate} center – mercator origin
     * @param {number} scale   – metres → mercator units
     * @param {Object} params  – simulation parameters
     * @param {string} caseType – "AGS" | "BTES"
     * @param {number} progress – animation 0→1
     */
    function buildVertices(center, scale, params, caseType, progress) {
        const arr   = [];
        const depth = (params.well_depth || 200) * HEIGHT_SCALE;

        let positions, hw;
        if (caseType === "BTES") {
            const n  = Math.min(params.num_wells_btes || 48, 80);
            const sp = params.well_spacing || 5;
            hw = PARK_WELL_HALF * scale;
            const vizSp = Math.max(PARK_WELL_HALF * 2.5, sp * (n > 20 ? 4 : 6));
            positions = hexLayout(n, vizSp);
        } else {
            positions = [{ dx: 0, dy: 0 }];
            hw = WELL_HALF * scale;
        }

        for (const pos of positions) {
            const cx = center.x + pos.dx * scale;
            const cy = center.y - pos.dy * scale;   // y inverted in mercator
            let curZ = 0;

            for (const layer of GEO_LAYERS) {
                const segH = depth * layer.fraction;
                const net  = Math.max(0, segH - SEGMENT_GAP);
                const z0   = curZ * scale * progress;
                const z1   = (curZ + net) * scale * progress;

                if (z1 > z0 + 1e-12) {
                    addBox(arr,
                        cx - hw, cy - hw, z0,
                        cx + hw, cy + hw, z1,
                        layer.color[0], layer.color[1], layer.color[2]);
                }
                curZ += segH;
            }
        }
        return new Float32Array(arr);
    }

    // ── Layer state (module-scoped singleton) ──────────────────────────────

    const S = {
        active:      false,
        map:         null,
        lngLat:      null,
        params:      null,
        caseType:    null,
        progress:    0,
        animStart:   0,
        needsBuild:  false,
        // GL handles
        program:     null,
        buffer:      null,
        vertCount:   0,
        aPos:        -1,
        aColor:      -1,
        uMatrix:     null,
    };

    // ── Geometry rebuild (call only inside render) ─────────────────────────

    function rebuild(gl) {
        if (!S.lngLat || !S.params || !S.buffer) return;
        const lng = S.lngLat.lng !== undefined ? S.lngLat.lng : S.lngLat[0];
        const lat = S.lngLat.lat !== undefined ? S.lngLat.lat : S.lngLat[1];
        const mc    = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], 0);
        const scale = mc.meterInMercatorCoordinateUnits();
        const verts = buildVertices(mc, scale, S.params, S.caseType, S.progress);
        gl.bindBuffer(gl.ARRAY_BUFFER, S.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
        S.vertCount = verts.length / 7;
    }

    // ── Custom layer object ────────────────────────────────────────────────

    const customLayer = {
        id: LAYER_ID,
        type: "custom",
        renderingMode: "3d",

        onAdd(_map, gl) {
            S.program = linkProgram(gl, VS_SRC, FS_SRC);
            if (!S.program) return;
            S.aPos    = gl.getAttribLocation(S.program, "a_pos");
            S.aColor  = gl.getAttribLocation(S.program, "a_color");
            S.uMatrix = gl.getUniformLocation(S.program, "u_matrix");
            S.buffer  = gl.createBuffer();
            S.needsBuild = true;
        },

        render(gl, matrix) {
            if (!S.active || !S.program) return;

            // ── animation tick ──
            let animating = false;
            if (S.progress < 1) {
                const t = Math.max(0, Math.min((performance.now() - S.animStart) / ANIM_DURATION, 1));
                S.progress = 1 - Math.pow(1 - t, 3);          // ease-out cubic
                S.needsBuild = true;
                animating = true;
            }

            if (S.needsBuild) {
                rebuild(gl);
                S.needsBuild = false;
            }
            if (S.vertCount === 0) return;

            // ── draw ──
            gl.useProgram(S.program);
            gl.uniformMatrix4fv(S.uMatrix, false, matrix);

            gl.bindBuffer(gl.ARRAY_BUFFER, S.buffer);
            const stride = 7 * 4;                              // 7 floats × 4 bytes
            gl.enableVertexAttribArray(S.aPos);
            gl.vertexAttribPointer(S.aPos,   3, gl.FLOAT, false, stride, 0);
            gl.enableVertexAttribArray(S.aColor);
            gl.vertexAttribPointer(S.aColor, 4, gl.FLOAT, false, stride, 12);

            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.enable(gl.DEPTH_TEST);

            gl.drawArrays(gl.TRIANGLES, 0, S.vertCount);

            if (animating && S.map) S.map.triggerRepaint();
        },

        onRemove(_map, gl) {
            if (S.buffer)  { gl.deleteBuffer(S.buffer);   S.buffer  = null; }
            if (S.program) { gl.deleteProgram(S.program);  S.program = null; }
            S.vertCount = 0;
        },
    };

    // ── Public API ─────────────────────────────────────────────────────────

    function show(map, lngLat, params, caseType) {
        // Remove any previous visualisation first
        removeLayer();

        S.map       = map;
        S.lngLat    = lngLat;
        S.params    = Object.assign({}, params);
        S.caseType  = caseType;
        S.active    = true;
        S.progress  = 0;
        S.animStart = performance.now() + ANIM_DELAY;

        if (!map.getLayer(LAYER_ID)) {
            map.addLayer(customLayer);
        }

        // Fly camera to the well
        const lng = lngLat.lng !== undefined ? lngLat.lng : lngLat[0];
        const lat = lngLat.lat !== undefined ? lngLat.lat : lngLat[1];
        map.flyTo({
            center: [lng, lat],
            zoom: FLY_ZOOM,
            pitch: FLY_PITCH,
            duration: 1200,
            essential: true,
        });

        map.triggerRepaint();
    }

    function update(params) {
        if (!S.active || !S.map) return;
        Object.assign(S.params, params);
        S.progress   = 1;
        S.needsBuild = true;
        S.map.triggerRepaint();
    }

    function removeLayer() {
        if (S.map && S.map.getLayer(LAYER_ID)) {
            try { S.map.removeLayer(LAYER_ID); } catch (_e) { /* already removed */ }
        }
        S.active    = false;
        S.vertCount = 0;
        S.params    = null;
        S.lngLat    = null;
        if (S.map) S.map.triggerRepaint();
        S.map = null;
    }

    // ── Expose & register extension ────────────────────────────────────────

    window.Wellbore3D = { show, update, remove: removeLayer };

    window.addEventListener("load", () => {
        if (!window.GeothermalViz) return;

        window.GeothermalViz.registerExtension({
            name: "Wellbore3D",
            onEvent(event, data) {
                switch (event) {
                case "simulationSetup":
                    show(
                        window.GeothermalViz.state.map,
                        data.lngLat,
                        data.params,
                        data.caseType,
                    );
                    break;
                case "simulationParamChange":
                    update(data.params);
                    break;
                case "simulationClosed":
                    removeLayer();
                    break;
                case "wellSelected":
                    if (S.active) removeLayer();
                    break;
                }
            },
        });
    });
})();
