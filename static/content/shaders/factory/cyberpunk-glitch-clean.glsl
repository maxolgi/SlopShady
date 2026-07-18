// Name: Cyberpunk Glitch (Clean Version)
// Cyberpunk Glitch (Clean Version)
// High-contrast neon colors with digital artifacts and chromatic aberration simulation

float rand(vec2 uv) {
    return fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
}

float get_pattern(vec2 p, float t) {
    float grid = smoothstep(0.45, 0.5, abs(fract(p.x * 8.0) - 0.5)) * 
                 smoothstep(0.45, 0.5, abs(fract(p.y * 8.0) - 0.5));
    float noise = fract(sin(dot(p + t, vec2(12.9898, 78.233))) * 43758.5453);
    return grid + noise * 0.2;
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    float time = iTime * 1.5;

    // Glitch strip movement
    float glitch_shift = 0.0;
    if (rand(vec2(time, floor(uv.y * 15.0))) < 0.1) {
        glitch_shift = (rand(vec2(time, uv.y)) - 0.5) * 0.15;
    }
    
    vec2 uv_g = uv + vec2(glitch_shift, 0.0);

    // Chromatic Aberration simulation
    float ca = 0.008 * sin(time * 2.0);
    
    float r = get_pattern(uv_g + vec2(ca, 0.0), time);
    float g = get_pattern(uv_g, time);
    float b = get_pattern(uv_g - vec2(ca, 0.0), time);

    // Color mapping: Cyan and Magenta
    vec3 cyan = vec3(0.0, 1.0, 1.0);
    vec3 magenta = vec3(1.0, 0.0, 1.0);
    vec3 dark = vec3(0.05, 0.0, 0.1);

    // Use R and B for cyan/magenta mix, G for intensity
    vec3 final_col = mix(dark, cyan, r * 0.5 + b * 0.5);
    final_col = mix(final_col, magenta, g * 0.5);

    // Add scanlines
    float scanline = smoothstep(0.48, 0.5, sin(uv_g.y * 300.0 + time * 10.0));
    final_col *= (0.9 + 0.1 * scanline);

    // Add random bright "glitch" flashes
    if (rand(vec2(time, floor(uv_g.y * 20.0))) < 0.05) {
        final_col += vec3(1.0, 1.0, 1.0) * 0.5;
    }

    fragColor = vec4(final_col, 1.0);
}
