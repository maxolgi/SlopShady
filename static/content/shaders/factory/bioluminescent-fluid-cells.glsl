// Name: Bioluminescent Fluid Cells
// Bioluminescent Fluid Cells
// An abstract shader simulating glowing, organic fluid structures

vec2 hash21(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 33.3)), dot(p, vec2(269.5, 183.3)));
    return fract(p * 43758.5453);
}

// Voronoi noise for cellular structures
float voronoi(vec2 p) {
    vec2 n = floor(p);
    vec2 f = fract(p);
    float d = 8.0;
    for (int i = -1; i <= 1; i++) {
        for (int j = -1; j <= 1; j++) {
            vec2 g = vec2(float(i), float(j));
            vec2 o = hash21(n + g);
            // Animate the points within cells
            vec2 offset = 0.5 * sin(iTime + 6.2831 * o + vec2(o.x, o.y) * 0.5);
            vec2 r = g + o + offset - f;
            float dist = dot(r, r);
            d = min(d, dist);
        }
    }
    return sqrt(d);
}

// Simple noise for fluid-like motion
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = dot(i, vec2(127.1, 33.3));
    float b = dot(i + vec2(1.0, 0.0), vec2(127.1, 33.3));
    float c = dot(i + vec2(0.0, 1.0), vec2(127.1, 33.3));
    float d = dot(i + vec2(1.0, 1.0), vec2(127.1, 33.3));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    uv = uv * 2.0 - 1.0;
    uv.x *= iResolution.x / iResolution.y;

    float time = iTime * 0.3;

    // Domain warping for fluid motion
    vec2 q = vec2(noise(uv + time), noise(uv + vec2(1.0, 0.5) + time));
    vec2 r = vec2(noise(uv + q + time * 0.5), noise(uv + q + vec2(0.5, 1.0) + time * 0.3));

    float v = voronoi(uv * 3.0 + r);
    
    // Color palette: Deep teal, Electric blue, Neon pink
    vec3 color_bg = vec3(0.02, 0.05, 0.08); // Very dark teal
    vec3 color_fluid = vec3(0.1, 0.6, 0.5); // Teal/Cyan
    vec3 color_glow = vec3(0.8, 0.2, 0.7);  // Neon Pink

    // Create the glowing edge effect using the voronoi distance
    float edge = smoothstep(0.0, 0.15, v) * smoothstep(0.5, 0.3, v);
    float glow = exp(-v * 4.0);

    vec3 col = mix(color_bg, color_fluid, edge);
    col += color_glow * glow * 0.4; // Add pink glow to edges
    col += vec3(0.2, 0.8, 1.0) * (1.0 - v) * 0.2; // Blueish internal light

    // Final brightness boost and vignette
    float vignette = smoothstep(1.5, 0.5, length(uv));
    col *= vignette;
    col += 0.1; // Ambient lift

    fragColor = vec4(col, 1.0);
}
