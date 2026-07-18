// Name: Cyberpunk Glitch
// Cyberpunk Glitch
// A shader simulating a distorted, high-tech digital display with glitch effects

// Simple 2D hash function
float hash(vec2 p) {
    p = fract(p * vec2(127.1, 33.3));
    return dot(p, p.xy + 10.0);
}

// Function to create a glitch distortion
vec2 glitch_distort(vec2 uv, float time) {
    float glitch_intensity = 0.0;
    
    // Occasional large jumps
    float jump = step(0.95, fract(time * 0.5));
    uv += (hash(vec2(floor(time * 10.0), 0.0)) - 0.5) * 0.05 * jump;

    // Horizontal scanline jitter
    float line_jitter = step(0.9, fract(hash(vec2(floor(uv.y * 500.0), time)) * 10.0));
    uv.x += (hash(vec2(floor(uv.y * 100.0), 0.0)) - 0.5) * 0.1 * line_jitter;

    // Sudden blocky distortions
    float block_size = 0.1;
    float block_check = step(0.98, fract(hash(vec2(floor(uv.x / block_size), floor(uv.y / block_size)) + time) * 5.0));
    uv += (hash(vec2(floor(uv.x/block_size), floor(uv.y/block_size) + time)) - 0.5) * 0.1 * block_check;

    return uv;
}

// Function to calculate the "base" color at a specific UV
vec3 get_base_color(vec2 uv, float time) {
    // Using noise-based pattern for the glitch content
    float d_density = fract(sin(uv.x * 5.0 + uv.y * 3.0 + time) * 1234.56);
    vec3 col = mix(vec3(0.02, 0.01, 0.05), vec3(0.4, 0.05, 0.3), d_density);
    col = mix(col, vec3(0.0, 0.3, 0.4), fract(sin(uv.x * 2.0 + time) * 100.0));
    return col;
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    uv = uv * 2.0 - 1.0;
    uv.x *= iResolution.x / iResolution.y;

    float time = iTime * 0.5;

    // Apply glitch distortion to the UVs
    vec2 distorted_uv = glitch_distort(uv, time);

    // Chromatic Aberration (splitting RGB channels)
    float aberration = 0.015;
    float r = get_base_color(distorted_uv + vec2(aberration, 0.0), time).r;
    float g = get_base_color(distorted_uv, time).g;
    float b = get_base_color(distorted_uv - vec2(aberration, 0.0), time).b;
    vec3 final_col = vec3(r, g, b);

    // Scanlines
    float scanline = sin(uv.y * 800.0) * 0.1 + 0.9;
    final_col *= scanline;

    // Digital "noise" / grain
    float grain = (hash(uv + time) - 0.5) * 0.1;
    final_col += grain;

    // Final vignette
    float vignette = smoothstep(1.5, 0.4, length(uv));
    final_col *= vignette;

    fragColor = vec4(final_col, 1.0);
}
