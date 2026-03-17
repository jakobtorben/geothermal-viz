/**
 * GeothermalViz – 3D Wellbore Visualization
 *
 * MapLibre custom layer that renders a wellbore as stacked 3D segment
 * cells above the well point on the map.  Segments represent the
 * simulation grid (controlled by the num_segments parameter).
 *
 * Features:
 * - Stacked well-segment cells with distinct boundaries
 * - Optional geological cross-section overlay (toggleable)
 * - Clear wellhead cap to mark the top of the well
 * - Vertical offset so the well floats above the map surface
 * - Animated "rise-up" effect when simulation setup is triggered
 * - Hexagonal layout for wellpark (BTES) with one column per well
 * - Real-time updates when grid parameters change in the setup form
 */
(function () {
    "use strict";

    // ── Constants & Configuration ──────────────────────────────────────────

    const LAYER_ID = "wellbore-3d";

    /** Geological cross-section layers (optional overlay). */
    const GEO_LAYERS = [
        { name: "Soil / Quaternary",      fraction: 0.05, color: [0.63, 0.52, 0.32] },
        { name: "Marine Clay",            fraction: 0.07, color: [0.72, 0.59, 0.42] },
        { name: "Glacial Till",           fraction: 0.08, color: [0.56, 0.53, 0.47] },
        { name: "Weathered Bedrock",      fraction: 0.08, color: [0.51, 0.48, 0.45] },
        { name: "Fractured Gneiss",       fraction: 0.15, color: [0.44, 0.48, 0.52] },
        { name: "Precambrian Gneiss",     fraction: 0.25, color: [0.38, 0.42, 0.46] },
        { name: "Granite / Granodiorite", fraction: 0.17, color: [0.33, 0.37, 0.40] },
        { name: "Deep Crystalline",       fraction: 0.15, color: [0.24, 0.30, 0.35] },
    ];

    const SEGMENT_GAP    = 2;       // metres gap between segments (grid lines)
    const VERTICAL_OFFSET = 40;     // metres above surface for the well base
    const WELL_HALF      = 12;      // half-width of single-well column (m)
    const PARK_WELL_HALF = 5;       // half-width per well in a wellpark (m)
    const CAP_HEIGHT_FRAC = 0.02;   // wellhead cap as fraction of total height
    const MIN_SEGMENTS   = 2;       // must match PARAM_METADATA min
    const MAX_SEGMENTS   = 100;     // must match PARAM_METADATA max
    const MAX_RENDERED_WELLS = 80;  // cap for BTES rendering (performance)
    const ANIM_DURATION  = 1200;    // rise animation duration (ms)
    const ANIM_DELAY     = 500;     // delay before animation starts (ms)
    const FLY_ZOOM       = 15.5;
    const FLY_PITCH      = 60;

    // Well segment colours – gradient from dark (bottom/deep) to light (top/shallow)
    const SEG_COLOR_DEEP    = [0.22, 0.36, 0.55];  // dark blue-grey (deep)
    const SEG_COLOR_SHALLOW = [0.45, 0.68, 0.82];  // light blue (shallow)
    const CAP_COLOR         = [0.85, 0.25, 0.20];  // red wellhead cap

    // Cross-section settings
    const XSECTION_OFFSET = 30;  // metres offset from well centre
    const XSECTION_HALF_W = 4;   // half-width of cross-section slab

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

    /** Linearly interpolate between two RGB colours. */
    function lerpColor(c0, c1, t) {
        return [
            c0[0] + (c1[0] - c0[0]) * t,
            c0[1] + (c1[1] - c0[1]) * t,
            c0[2] + (c1[2] - c0[2]) * t,
        ];
    }

    /**
     * Append a box (36 verts) to `arr`.
     * Face-dependent shade simulates directional lighting.
     */
    function addBox(arr, x0, y0, z0, x1, y1, z1, cr, cg, cb, alpha) {
        const S = { top: 1.0, front: 0.82, right: 0.73, back: 0.65, left: 0.58, bot: 0.42 };
        const A = alpha !== undefined ? alpha : 0.92;
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
     * Build vertex data for well segments.
     *
     * Segments are stacked bottom-to-top.  The bottom of the well is at
     * VERTICAL_OFFSET above the surface; the top segment is highest.
     * A red wellhead cap sits on top to mark the wellhead.
     *
     * The colour gradient goes from deep (dark) at bottom to shallow (light)
     * at top, making it clear which end is the wellhead.
     */
    function buildVertices(center, scale, params, caseType, progress) {
        const arr   = [];
        const depth = params.well_depth || 200;
        const nSeg  = Math.max(MIN_SEGMENTS, Math.min(Math.round(params.num_segments || 10), MAX_SEGMENTS));

        let positions, hw;
        if (caseType === "BTES") {
            const n  = Math.min(params.num_wells_btes || 48, MAX_RENDERED_WELLS);
            const sp = params.well_spacing || 5;
            hw = PARK_WELL_HALF * scale;
            const displaySpacing = Math.max(PARK_WELL_HALF * 2.5, sp * (n > 20 ? 4 : 6));
            positions = hexLayout(n, displaySpacing);
        } else {
            positions = [{ dx: 0, dy: 0 }];
            hw = WELL_HALF * scale;
        }

        const segH = depth / nSeg;

        for (const pos of positions) {
            const cx = center.x + pos.dx * scale;
            const cy = center.y - pos.dy * scale;
            let curZ = VERTICAL_OFFSET;

            // Well segments (bottom = deep, top = shallow)
            for (let i = 0; i < nSeg; i++) {
                const t = nSeg > 1 ? i / (nSeg - 1) : 0;
                const col = lerpColor(SEG_COLOR_DEEP, SEG_COLOR_SHALLOW, t);

                const net  = Math.max(0, segH - SEGMENT_GAP);
                const z0   = curZ * scale * progress;
                const z1   = (curZ + net) * scale * progress;

                if (z1 > z0 + 1e-12) {
                    addBox(arr,
                        cx - hw, cy - hw, z0,
                        cx + hw, cy + hw, z1,
                        col[0], col[1], col[2], 0.92);
                }
                curZ += segH;
            }

            // Wellhead cap (red marker on top)
            const capH  = Math.max(depth * CAP_HEIGHT_FRAC, 3);
            const capZ0 = curZ * scale * progress;
            const capZ1 = (curZ + capH) * scale * progress;
            const capHw = hw * 1.15;
            if (capZ1 > capZ0 + 1e-12) {
                addBox(arr,
                    cx - capHw, cy - capHw, capZ0,
                    cx + capHw, cy + capHw, capZ1,
                    CAP_COLOR[0], CAP_COLOR[1], CAP_COLOR[2], 0.95);
            }
        }
        return new Float32Array(arr);
    }

    /**
     * Build vertex data for the geological cross-section overlay.
     */
    function buildCrossSectionVertices(center, scale, params, progress) {
        const arr   = [];
        const depth = params.well_depth || 200;
        const hw    = XSECTION_HALF_W * scale;

        const cx = center.x + XSECTION_OFFSET * scale;
        const cy = center.y;
        let curZ = VERTICAL_OFFSET;

        for (const layer of GEO_LAYERS) {
            const segH = depth * layer.fraction;
            const z0 = curZ * scale * progress;
            const z1 = (curZ + segH) * scale * progress;
            if (z1 > z0 + 1e-12) {
                addBox(arr,
                    cx - hw, cy - hw, z0,
                    cx + hw, cy + hw, z1,
                    layer.color[0], layer.color[1], layer.color[2],
                    layerState.xsectionOpacity);
            }
            curZ += segH;
        }
        return new Float32Array(arr);
    }

    // ── Layer state (module-scoped singleton) ──────────────────────────────

    const layerState = {
        active:          false,
        map:             null,
        lngLat:          null,
        params:          null,
        caseType:        null,
        progress:        0,
        animStart:       0,
        needsBuild:      false,
        // Cross-section
        showXsection:    false,
        xsectionOpacity: 0.55,
        xsNeedsBuild:    false,
        // GL handles — main well
        program:     null,
        buffer:      null,
        vertCount:   0,
        aPos:        -1,
        aColor:      -1,
        uMatrix:     null,
        // GL handles — cross-section (shares program)
        xsBuffer:    null,
        xsVertCount: 0,
    };

    // ── Geometry rebuild ───────────────────────────────────────────────────

    function getLngLat() {
        if (!layerState.lngLat) return null;
        const lng = layerState.lngLat.lng !== undefined ? layerState.lngLat.lng : layerState.lngLat[0];
        const lat = layerState.lngLat.lat !== undefined ? layerState.lngLat.lat : layerState.lngLat[1];
        return [lng, lat];
    }

    function rebuild(gl) {
        const ll = getLngLat();
        if (!ll || !layerState.params || !layerState.buffer) return;
        const mc    = maplibregl.MercatorCoordinate.fromLngLat(ll, 0);
        const scale = mc.meterInMercatorCoordinateUnits();
        const verts = buildVertices(mc, scale, layerState.params, layerState.caseType, layerState.progress);
        gl.bindBuffer(gl.ARRAY_BUFFER, layerState.buffer);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
        layerState.vertCount = verts.length / 7;
    }

    function rebuildXsection(gl) {
        const ll = getLngLat();
        if (!ll || !layerState.params || !layerState.xsBuffer) return;
        if (!layerState.showXsection) {
            layerState.xsVertCount = 0;
            return;
        }
        const mc    = maplibregl.MercatorCoordinate.fromLngLat(ll, 0);
        const scale = mc.meterInMercatorCoordinateUnits();
        const verts = buildCrossSectionVertices(mc, scale, layerState.params, layerState.progress);
        gl.bindBuffer(gl.ARRAY_BUFFER, layerState.xsBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, verts, gl.DYNAMIC_DRAW);
        layerState.xsVertCount = verts.length / 7;
    }

    // ── Custom layer object ────────────────────────────────────────────────

    const customLayer = {
        id: LAYER_ID,
        type: "custom",
        renderingMode: "3d",

        onAdd(_map, gl) {
            layerState.program = linkProgram(gl, VS_SRC, FS_SRC);
            if (!layerState.program) return;
            layerState.aPos    = gl.getAttribLocation(layerState.program, "a_pos");
            layerState.aColor  = gl.getAttribLocation(layerState.program, "a_color");
            layerState.uMatrix = gl.getUniformLocation(layerState.program, "u_matrix");
            layerState.buffer    = gl.createBuffer();
            layerState.xsBuffer  = gl.createBuffer();
            layerState.needsBuild  = true;
            layerState.xsNeedsBuild = true;
        },

        render(gl, matrix) {
            if (!layerState.active || !layerState.program) return;

            // ── animation tick ──
            let animating = false;
            if (layerState.progress < 1) {
                const t = Math.max(0, Math.min((performance.now() - layerState.animStart) / ANIM_DURATION, 1));
                layerState.progress = 1 - Math.pow(1 - t, 3);  // ease-out cubic
                layerState.needsBuild  = true;
                layerState.xsNeedsBuild = true;
                animating = true;
            }

            if (layerState.needsBuild) {
                rebuild(gl);
                layerState.needsBuild = false;
            }
            if (layerState.xsNeedsBuild) {
                rebuildXsection(gl);
                layerState.xsNeedsBuild = false;
            }

            gl.useProgram(layerState.program);
            gl.uniformMatrix4fv(layerState.uMatrix, false, matrix);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.enable(gl.DEPTH_TEST);

            const stride = 7 * 4;

            // Draw main well segments
            if (layerState.vertCount > 0) {
                gl.bindBuffer(gl.ARRAY_BUFFER, layerState.buffer);
                gl.enableVertexAttribArray(layerState.aPos);
                gl.vertexAttribPointer(layerState.aPos,   3, gl.FLOAT, false, stride, 0);
                gl.enableVertexAttribArray(layerState.aColor);
                gl.vertexAttribPointer(layerState.aColor, 4, gl.FLOAT, false, stride, 12);
                gl.drawArrays(gl.TRIANGLES, 0, layerState.vertCount);
            }

            // Draw cross-section overlay
            if (layerState.xsVertCount > 0) {
                gl.bindBuffer(gl.ARRAY_BUFFER, layerState.xsBuffer);
                gl.enableVertexAttribArray(layerState.aPos);
                gl.vertexAttribPointer(layerState.aPos,   3, gl.FLOAT, false, stride, 0);
                gl.enableVertexAttribArray(layerState.aColor);
                gl.vertexAttribPointer(layerState.aColor, 4, gl.FLOAT, false, stride, 12);
                gl.drawArrays(gl.TRIANGLES, 0, layerState.xsVertCount);
            }

            if (animating && layerState.map) layerState.map.triggerRepaint();
        },

        onRemove(_map, gl) {
            if (layerState.buffer)   { gl.deleteBuffer(layerState.buffer);   layerState.buffer   = null; }
            if (layerState.xsBuffer) { gl.deleteBuffer(layerState.xsBuffer); layerState.xsBuffer = null; }
            if (layerState.program)  { gl.deleteProgram(layerState.program);  layerState.program  = null; }
            layerState.vertCount   = 0;
            layerState.xsVertCount = 0;
        },
    };

    // ── Public API ─────────────────────────────────────────────────────────

    function show(map, lngLat, params, caseType) {
        removeLayer();

        layerState.map       = map;
        layerState.lngLat    = lngLat;
        layerState.params    = Object.assign({}, params);
        layerState.caseType  = caseType;
        layerState.active    = true;
        layerState.progress  = 0;
        layerState.animStart = performance.now() + ANIM_DELAY;

        if (!map.getLayer(LAYER_ID)) {
            map.addLayer(customLayer);
        }

        const ll = getLngLat();
        if (ll) {
            map.flyTo({
                center: ll,
                zoom: FLY_ZOOM,
                pitch: FLY_PITCH,
                duration: 1200,
                essential: true,
            });
        }

        map.triggerRepaint();
    }

    function update(params) {
        if (!layerState.active || !layerState.map) return;
        Object.assign(layerState.params, params);
        layerState.progress       = 1;
        layerState.needsBuild     = true;
        layerState.xsNeedsBuild   = true;
        layerState.map.triggerRepaint();
    }

    function toggleCrossSection(visible) {
        layerState.showXsection = visible !== undefined ? visible : !layerState.showXsection;
        layerState.xsNeedsBuild = true;
        if (layerState.map) layerState.map.triggerRepaint();
    }

    function setCrossSectionOpacity(val) {
        layerState.xsectionOpacity = Math.max(0, Math.min(1, val));
        layerState.xsNeedsBuild = true;
        if (layerState.map) layerState.map.triggerRepaint();
    }

    function removeLayer() {
        if (layerState.map && layerState.map.getLayer(LAYER_ID)) {
            try { layerState.map.removeLayer(LAYER_ID); } catch (_e) { /* already removed */ }
        }
        layerState.active      = false;
        layerState.vertCount   = 0;
        layerState.xsVertCount = 0;
        layerState.params      = null;
        layerState.lngLat      = null;
        if (layerState.map) layerState.map.triggerRepaint();
        layerState.map = null;
    }

    // ── Expose & register extension ────────────────────────────────────────

    window.Wellbore3D = { show, update, remove: removeLayer, toggleCrossSection, setCrossSectionOpacity };

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
                    if (layerState.active) removeLayer();
                    break;
                }
            },
        });
    });
})();
