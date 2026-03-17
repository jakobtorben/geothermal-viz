/**
 * GeothermalViz – 3D Wellbore Visualization
 *
 * MapLibre custom layer that renders a wellbore as stacked octagonal
 * cylinder segments above the well point on the map.
 *
 * Inspired by a prototype with:
 * - Stacked octagonal cylinder segments with gaps between them
 * - Wireframe edge overlay on each cell boundary
 * - Semi-transparent outer casing tube
 * - Thin inner drill-string tube
 * - Depth-mapped colour via a swappable function
 * - Clear wellhead cap to mark the top
 * - Vertical offset so the well floats above the surface
 * - Animated "rise-up" effect
 * - Hexagonal layout for wellpark (BTES)
 * - Real-time updates when grid parameters change
 */
(function () {
    "use strict";

    // ── Constants & Configuration ──────────────────────────────────────────

    const LAYER_ID = "wellbore-3d";

    const SEGMENT_GAP_FRAC = 0.08;  // fraction of segment height used as gap
    const VERTICAL_OFFSET  = 40;    // metres above surface for well base
    const WELL_RADIUS      = 8;     // radius of single-well column (m)
    const PARK_WELL_RADIUS = 3.5;   // radius per well in a wellpark (m)
    const CASING_RADIUS_MULT = 1.3; // outer casing radius multiplier
    const DRILL_RADIUS_MULT  = 0.25; // inner drill string radius multiplier
    const CAP_HEIGHT_FRAC  = 0.025; // wellhead cap height as fraction of depth
    const N_SIDES          = 8;     // octagonal cross-section
    const MIN_SEGMENTS     = 2;
    const MAX_SEGMENTS     = 100;
    const MAX_RENDERED_WELLS = 80;
    const ANIM_DURATION    = 1200;
    const ANIM_DELAY       = 500;
    const FLY_ZOOM         = 15.5;
    const FLY_PITCH        = 60;

    // Colour palette
    const CAP_COLOR        = [0.85, 0.22, 0.18]; // red wellhead
    const CASING_COLOR     = [0.55, 0.58, 0.62]; // steel grey
    const DRILL_COLOR      = [0.35, 0.35, 0.38]; // dark grey
    const WIRE_COLOR       = [0.15, 0.15, 0.18]; // near-black wireframe

    // ── Colour mapping function (swappable) ───────────────────────────────

    /**
     * Default depth-based colour ramp:  warm deep → cool shallow.
     * @param {number} t  normalised position  0 = deep, 1 = shallow
     * @returns {number[]} [r, g, b] in 0–1 range
     */
    function depthColor(t) {
        // deep: warm amber-brown [0.72, 0.38, 0.18]
        // mid:  teal-blue        [0.20, 0.55, 0.65]
        // shallow: cool blue-white [0.48, 0.78, 0.92]
        if (t < 0.5) {
            const s = t * 2; // 0→1 within lower half
            return [
                0.72 + (0.20 - 0.72) * s,
                0.38 + (0.55 - 0.38) * s,
                0.18 + (0.65 - 0.18) * s,
            ];
        }
        const s = (t - 0.5) * 2; // 0→1 within upper half
        return [
            0.20 + (0.48 - 0.20) * s,
            0.55 + (0.78 - 0.55) * s,
            0.65 + (0.92 - 0.65) * s,
        ];
    }

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

    /** Pre-compute the unit-circle vertices for an N-sided polygon. */
    function polyCircle(n) {
        const pts = [];
        for (let i = 0; i < n; i++) {
            const a = (2 * Math.PI * i) / n;
            pts.push({ x: Math.cos(a), y: Math.sin(a) });
        }
        return pts;
    }

    const CIRCLE = polyCircle(N_SIDES);

    /** Push a single vertex into array: 3 pos + 4 colour/alpha. */
    function v(arr, x, y, z, r, g, b, a) {
        arr.push(x, y, z, r, g, b, a);
    }

    /**
     * Add a filled octagonal cylinder (top + bottom caps + side quads)
     * as triangles for a segment cell.
     *
     * @param {number[]} arr  - vertex accumulator
     * @param {number} cx,cy  - centre in Mercator coords
     * @param {number} z0,z1  - bottom and top z in Mercator coords
     * @param {number} radius - in Mercator units
     * @param {number[]} col  - [r, g, b] base colour
     * @param {number} alpha  - opacity
     */
    function addCylinder(arr, cx, cy, z0, z1, radius, col, alpha) {
        const pts = CIRCLE;
        const n = pts.length;
        const cr = col[0], cg = col[1], cb = col[2];

        // Shade multipliers for pseudo-lighting
        const topShade = 1.0, botShade = 0.45;

        // Top cap (fan from centre)
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const s = topShade;
            v(arr, cx, cy, z1, cr*s, cg*s, cb*s, alpha);
            v(arr, cx + pts[i].x * radius, cy + pts[i].y * radius, z1, cr*s, cg*s, cb*s, alpha);
            v(arr, cx + pts[j].x * radius, cy + pts[j].y * radius, z1, cr*s, cg*s, cb*s, alpha);
        }

        // Bottom cap
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            const s = botShade;
            v(arr, cx, cy, z0, cr*s, cg*s, cb*s, alpha);
            v(arr, cx + pts[j].x * radius, cy + pts[j].y * radius, z0, cr*s, cg*s, cb*s, alpha);
            v(arr, cx + pts[i].x * radius, cy + pts[i].y * radius, z0, cr*s, cg*s, cb*s, alpha);
        }

        // Side faces (two triangles per quad)
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            // Face-dependent shade based on face normal angle
            const faceAngle = Math.atan2(
                (pts[i].y + pts[j].y) * 0.5,
                (pts[i].x + pts[j].x) * 0.5
            );
            const s = 0.55 + 0.35 * Math.max(0, Math.cos(faceAngle - 0.8));

            const ax = cx + pts[i].x * radius, ay = cy + pts[i].y * radius;
            const bx = cx + pts[j].x * radius, by = cy + pts[j].y * radius;

            v(arr, ax, ay, z0, cr*s, cg*s, cb*s, alpha);
            v(arr, bx, by, z0, cr*s, cg*s, cb*s, alpha);
            v(arr, bx, by, z1, cr*s, cg*s, cb*s, alpha);

            v(arr, ax, ay, z0, cr*s, cg*s, cb*s, alpha);
            v(arr, bx, by, z1, cr*s, cg*s, cb*s, alpha);
            v(arr, ax, ay, z1, cr*s, cg*s, cb*s, alpha);
        }
    }

    /**
     * Add wireframe edges for one octagonal segment cell.
     * Uses thin degenerate quads to simulate line rendering.
     *
     * @param {number[]} arr  - vertex accumulator
     * @param {number} cx,cy  - centre
     * @param {number} z0,z1  - bottom and top z
     * @param {number} radius - in Mercator units
     * @param {number} thick  - line "half-width" in Mercator units
     */
    function addWireframe(arr, cx, cy, z0, z1, radius, thick) {
        const pts = CIRCLE;
        const n = pts.length;
        const wr = WIRE_COLOR[0], wg = WIRE_COLOR[1], wb = WIRE_COLOR[2];
        const wa = 0.70;

        // Helper: draw a thin quad between two 3D points
        function edgeLine(x0, y0, z0p, x1, y1, z1p) {
            // perpendicular offset for thickness
            const dx = x1 - x0, dy = y1 - y0, dz = z1p - z0p;
            const len = Math.sqrt(dx*dx + dy*dy + dz*dz);
            if (len < 1e-20) return;
            // use a fixed offset direction (outward from centre)
            const mx = (x0 + x1) * 0.5 - cx;
            const my = (y0 + y1) * 0.5 - cy;
            const mLen = Math.sqrt(mx*mx + my*my);
            let nx, ny;
            if (mLen > 1e-20) {
                nx = mx / mLen * thick;
                ny = my / mLen * thick;
            } else {
                nx = thick;
                ny = 0;
            }

            v(arr, x0 - nx, y0 - ny, z0p, wr, wg, wb, wa);
            v(arr, x0 + nx, y0 + ny, z0p, wr, wg, wb, wa);
            v(arr, x1 + nx, y1 + ny, z1p, wr, wg, wb, wa);

            v(arr, x0 - nx, y0 - ny, z0p, wr, wg, wb, wa);
            v(arr, x1 + nx, y1 + ny, z1p, wr, wg, wb, wa);
            v(arr, x1 - nx, y1 - ny, z1p, wr, wg, wb, wa);
        }

        // Top ring
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            edgeLine(
                cx + pts[i].x * radius, cy + pts[i].y * radius, z1,
                cx + pts[j].x * radius, cy + pts[j].y * radius, z1
            );
        }

        // Bottom ring
        for (let i = 0; i < n; i++) {
            const j = (i + 1) % n;
            edgeLine(
                cx + pts[i].x * radius, cy + pts[i].y * radius, z0,
                cx + pts[j].x * radius, cy + pts[j].y * radius, z0
            );
        }

        // Vertical edges
        for (let i = 0; i < n; i++) {
            edgeLine(
                cx + pts[i].x * radius, cy + pts[i].y * radius, z0,
                cx + pts[i].x * radius, cy + pts[i].y * radius, z1
            );
        }
    }

    // ── Build full wellbore geometry ───────────────────────────────────────

    /**
     * Build all vertex data for the well visualisation.
     *
     * Order of drawing layers (all in one buffer):
     * 1. Filled segment cylinders (depth-coloured, opaque)
     * 2. Wireframe edges per segment
     * 3. Outer casing tube (semi-transparent)
     * 4. Inner drill-string tube
     * 5. Wellhead cap (red marker)
     */
    function buildVertices(center, scale, params, caseType, progress) {
        const arr   = [];
        const depth = params.well_depth || 200;
        const nSeg  = Math.max(MIN_SEGMENTS, Math.min(Math.round(params.num_segments || 10), MAX_SEGMENTS));

        let positions, baseRadius;
        if (caseType === "BTES") {
            const n  = Math.min(params.num_wells_btes || 48, MAX_RENDERED_WELLS);
            const sp = params.well_spacing || 5;
            baseRadius = PARK_WELL_RADIUS * scale;
            const displaySpacing = Math.max(PARK_WELL_RADIUS * 3, sp * (n > 20 ? 4 : 6));
            positions = hexLayout(n, displaySpacing);
        } else {
            positions = [{ dx: 0, dy: 0 }];
            baseRadius = WELL_RADIUS * scale;
        }

        const segTotal  = depth / nSeg;
        const gapHeight = segTotal * SEGMENT_GAP_FRAC;
        const segHeight = segTotal - gapHeight;
        const wireThick = baseRadius * 0.04;

        for (const pos of positions) {
            const cx = center.x + pos.dx * scale;
            const cy = center.y - pos.dy * scale;
            let curZ = VERTICAL_OFFSET;

            // ── 1. Segment cylinders (bottom = deep, top = shallow) ──
            for (let i = 0; i < nSeg; i++) {
                const t   = nSeg > 1 ? i / (nSeg - 1) : 0.5;
                const col = depthColor(t);
                const z0  = curZ * scale * progress;
                const z1  = (curZ + segHeight) * scale * progress;

                if (z1 > z0 + 1e-12) {
                    addCylinder(arr, cx, cy, z0, z1, baseRadius, col, 0.92);
                }
                curZ += segTotal;
            }

            // ── 2. Wireframe edges per segment ──
            curZ = VERTICAL_OFFSET;
            for (let i = 0; i < nSeg; i++) {
                const z0 = curZ * scale * progress;
                const z1 = (curZ + segHeight) * scale * progress;
                if (z1 > z0 + 1e-12) {
                    addWireframe(arr, cx, cy, z0, z1, baseRadius, wireThick);
                }
                curZ += segTotal;
            }

            // ── 3. Outer casing tube (semi-transparent) ──
            const casingR = baseRadius * CASING_RADIUS_MULT;
            const wellZ0  = VERTICAL_OFFSET * scale * progress;
            const wellZ1  = (VERTICAL_OFFSET + depth) * scale * progress;
            if (wellZ1 > wellZ0 + 1e-12) {
                addCylinder(arr, cx, cy, wellZ0, wellZ1, casingR, CASING_COLOR, 0.15);
            }

            // ── 4. Inner drill-string tube ──
            const drillR = baseRadius * DRILL_RADIUS_MULT;
            if (wellZ1 > wellZ0 + 1e-12) {
                addCylinder(arr, cx, cy, wellZ0, wellZ1, drillR, DRILL_COLOR, 0.85);
            }

            // ── 5. Wellhead cap (red marker on top) ──
            const capH  = Math.max(depth * CAP_HEIGHT_FRAC, 3);
            const capZ0 = (VERTICAL_OFFSET + depth) * scale * progress;
            const capZ1 = (VERTICAL_OFFSET + depth + capH) * scale * progress;
            const capR  = baseRadius * 1.25;
            if (capZ1 > capZ0 + 1e-12) {
                addCylinder(arr, cx, cy, capZ0, capZ1, capR, CAP_COLOR, 0.95);
            }
        }
        return new Float32Array(arr);
    }

    // ── Layer state (module-scoped singleton) ──────────────────────────────

    const layerState = {
        active:     false,
        map:        null,
        lngLat:     null,
        params:     null,
        caseType:   null,
        progress:   0,
        animStart:  0,
        needsBuild: false,
        // GL handles
        program:    null,
        buffer:     null,
        vertCount:  0,
        aPos:       -1,
        aColor:     -1,
        uMatrix:    null,
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
            layerState.buffer  = gl.createBuffer();
            layerState.needsBuild = true;
        },

        render(gl, matrix) {
            if (!layerState.active || !layerState.program) return;

            // ── animation tick ──
            let animating = false;
            if (layerState.progress < 1) {
                const t = Math.max(0, Math.min((performance.now() - layerState.animStart) / ANIM_DURATION, 1));
                layerState.progress = 1 - Math.pow(1 - t, 3);  // ease-out cubic
                layerState.needsBuild = true;
                animating = true;
            }

            if (layerState.needsBuild) {
                rebuild(gl);
                layerState.needsBuild = false;
            }
            if (layerState.vertCount === 0) return;

            gl.useProgram(layerState.program);
            gl.uniformMatrix4fv(layerState.uMatrix, false, matrix);
            gl.enable(gl.BLEND);
            gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
            gl.enable(gl.DEPTH_TEST);

            const stride = 7 * 4;
            gl.bindBuffer(gl.ARRAY_BUFFER, layerState.buffer);
            gl.enableVertexAttribArray(layerState.aPos);
            gl.vertexAttribPointer(layerState.aPos,   3, gl.FLOAT, false, stride, 0);
            gl.enableVertexAttribArray(layerState.aColor);
            gl.vertexAttribPointer(layerState.aColor, 4, gl.FLOAT, false, stride, 12);
            gl.drawArrays(gl.TRIANGLES, 0, layerState.vertCount);

            if (animating && layerState.map) layerState.map.triggerRepaint();
        },

        onRemove(_map, gl) {
            if (layerState.buffer)  { gl.deleteBuffer(layerState.buffer);   layerState.buffer  = null; }
            if (layerState.program) { gl.deleteProgram(layerState.program);  layerState.program = null; }
            layerState.vertCount = 0;
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
        layerState.progress   = 1;
        layerState.needsBuild = true;
        layerState.map.triggerRepaint();
    }

    function removeLayer() {
        if (layerState.map && layerState.map.getLayer(LAYER_ID)) {
            try { layerState.map.removeLayer(LAYER_ID); } catch (_e) { /* already removed */ }
        }
        layerState.active    = false;
        layerState.vertCount = 0;
        layerState.params    = null;
        layerState.lngLat    = null;
        if (layerState.map) layerState.map.triggerRepaint();
        layerState.map = null;
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
                    if (layerState.active) removeLayer();
                    break;
                }
            },
        });
    });
})();
