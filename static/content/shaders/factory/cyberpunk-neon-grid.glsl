// Name: Cyberpunk Neon Grid
// Cyberpunk Neon Grid
// A glitchy, glowing neon grid with periodic pulses and interference

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

    // --- Glitch Effect ---
    float glitch_chance = step(0.97, sin(t * 5.0 + hash(vec2(t)) * 10.0));
    float shift = (noise(vec2(t * 0.5, uv.y * 10.0)) - 0.5) * 0.1 * glitch_chance;
    uv.x += shift;

    // --- Grid Setup ---
    float gridSize = 8.0;
    vec2 gridUV = fract(uv * gridSize) - 0.5;
    
    // Line thickness and glow
    float lineThickness = 0.03;
    float edgeDist = min(abs(gridUV.x), abs(gridUV.y));
    float lines = smoothstep(lineThickness, 0.0, edgeDist);

    // --- Color Palette ---
    vec3 deepBlue = vec3(0.05, 0.0, 0.1);
    vec3 cyan = vec3(0.0, 1.0, 1.0);
    vec3 magenta = vec3(1.0, 0.0, 1.0);

    // Pulse effect
    float pulse = sin(t * 2.0) * 0.5 + 0.5;
    vec3 gridColor = mix(cyan, magenta, pulse);

    // --- Final Composition ---
    vec3 col = deepBlue;
    col += lines * gridColor * (0.5 + pulse * 0.5); // Add glowing lines
    
    // Add a subtle scanline effect
    float scanline = sin(uv.y * 400.0 + t * 2.0) * 0.04;
    col += scanline;

    // Add some noise/grain
    float grain = (noise(uv + t) - 0.5) * 0.1;
    col += grain;

    // Vignette
    float vignette = smoothstep(1.5, 0.5, length(uv));
    col *= vignette;

    fragColor = vec4(col, 1.0);
}
