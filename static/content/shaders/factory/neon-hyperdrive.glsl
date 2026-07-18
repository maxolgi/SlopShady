// Name: Neon Hyperdrive
// Neon Hyperdrive
// A high-speed tunnel effect with neon lines rushing towards the viewer

float hash(vec2 p) {
    p = fract(p * vec2(127.1, 301.7));
    p += dot(p, p.xy + 10.0);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    uv = uv * 2.0 - 1.0;
    uv.x *= iResolution.x / iResolution.y;

    float t = iTime;

    // --- Hyperdrive Motion Setup ---
    // We'll use polar coordinates to create the tunnel effect
    float angle = atan(uv.y, uv.x);
    float radius = length(uv);
    
    // The "depth" of the tunnel moves with time
    float depth = fract(t * 1.5); 
    
    // We'll create concentric rings and radial lines
    // To make them move towards us, we manipulate the radius based on time
    float ring_speed = 2.0;
    float rings = sin(radius * 20.0 - t * ring_speed);
    
    float line_speed = 3.0;
    float lines = sin(angle * 15.0 + t * line_speed);

    // --- Color Palette ---
    vec3 deepBlack = vec3(0.01, 0.0, 0.02);
    vec3 neonCyan = vec3(0.0, 1.0, 1.0);
    vec3 neonMagenta = vec3(1.0, 0.0, 1.0);
    vec3 neonYellow = vec3(1.0, 1.0, 0.0);

    // --- Creating the Tunnel Lines ---
    // Combine rings and lines to create a grid-like tunnel structure
    float pattern = smoothstep(0.5, 0.8, rings * lines);
    vec3 col_base = mix(neonCyan, neonMagenta, sin(t * 1.2) * 0.5 + 0.5);
    
    // --- Adding Glow & Bloom ---
    // We'll use a more complex pattern to simulate light streaks
    float glow = exp(-radius * 3.0) * (0.5 + 0.5 * sin(t * 2.0));
    vec3 col = deepBlack;
    col += pattern * col_base * glow * 1.5;

    // --- Adding Star-like Particles ---
    float star_count = 50.0;
    float star_pattern = hash(vec2(floor(angle * star_count), floor(radius * star_count)));
    if (star_pattern > 0.98) {
        float star_size = 0.02;
        float star_glow = exp(-length(uv - vec2(sin(t)*0.5, cos(t)*0.5)) * 5.0); // This is a very simplified particle
        col += neonYellow * star_glow * 0.5;
    }

    // --- Glitch Distortion ---
    float glitch_t = t * 10.0;
    if (mod(t, 2.0) > 1.95) {
        uv.x += noise(vec2(t, uv.y)) * 0.1;
        col += neonYellow * 0.2;
    }

    // --- Vignette & Final Polish ---
    float vignette = smoothstep(1.5, 0.3, radius);
    col *= vignette;

    // Add some scanlines for a retro feel
    float scanline = sin(gl_FragCoord.y * 0.8 + t * 2.0) * 0.03;
    col += scanline;

    fragColor = vec4(col, 1.0);
}
