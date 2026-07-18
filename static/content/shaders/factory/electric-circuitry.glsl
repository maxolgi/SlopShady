// Name: Electric Circuitry
// Electric Circuitry
// A glowing, animated circuit board with moving pulses of energy

float hash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p.xy + 10.0);
    return fract(p.x * p.y);
}

float line(vec2 p, vec2 a, vec2 b, float thickness) {
    vec2 pa = p - a, ba = b - a;
    float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
    return length(pa - ba * h) - thickness;
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    uv = uv * 2.0 - 1.0;
    uv.x *= iResolution.x / iResolution.y;
    float t = iTime;

    // Base metallic texture
    vec3 col = vec3(0.05, 0.07, 0.1); // Dark steel/obsidian
    col += (hash(uv + t * 0.1) - 0.5) * 0.02; // Subtle grain

    // Create a grid-like structure for "traces"
    float grid_size = 0.4;
    vec2 grid_uv = fract(uv / grid_size) - 0.5;
    vec2 cell_id = floor(uv / grid_size);
    
    // Deterministic paths within each cell
    float path_h = hash(cell_id);
    float path_v = hash(cell_id + 1.23);
    
    vec2 start_p = vec2(-0.5, 0.0);
    vec2 end_p;
    if (path_h < 0.5) {
        end_p = vec2(0.5, path_v - 0.5);
    } else {
        end_p = vec2(path_v - 0.5, 0.5);
    }

    // The trace line (the copper/gold path)
    float trace = line(grid_uv, start_p, end_p, 0.01);
    float trace_glow = smoothstep(0.02, 0.0, trace);
    col += trace_glow * vec3(0.8, 0.6, 0.2); // Gold/Copper color

    // Moving energy pulse
    float pulse_pos = fract(t * 0.5 + path_h);
    vec2 pulse_p = start_p + end_p * pulse_pos;
    float pulse = smoothstep(0.03, 0.0, length(grid_uv - pulse_p));
    col += pulse * vec3(0.0, 1.0, 0.8) * 2.0; // Cyan neon pulse

    // Add some "components" (rectangles/squares)
    float comp = smoothstep(0.15, 0.1, length(grid_uv - vec2(0.0, 0.0)));
    col += comp * vec3(0.1, 0.12, 0.15); // Dark component body
    col += comp * (hash(cell_id) * 0.1) * vec3(0.8, 0.6, 0.2); // Gold contact

    // Final glow and vignette
    float vignette = smoothstep(1.5, 0.5, length(uv));
    col *= vignette;

    fragColor = vec4(col, 1.0);
}
