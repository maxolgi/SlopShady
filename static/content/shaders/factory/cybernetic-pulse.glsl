// Name: Cybernetic Pulse
// Cybernetic Pulse
// A shader featuring a rhythmic, distorting digital grid with glowing pulses

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    uv = uv * 2.0 - 1.0;
    uv.x *= iResolution.x / iResolution.y;

    float time = iTime * 0.8;

    // Create a distorted grid pattern
    vec2 grid_uv = uv;
    float distortion = sin(uv.y * 5.0 + time) * cos(uv.x * 5.0 - time) * 0.1;
    grid_uv += distortion;

    // Grid lines
    vec2 grid = abs(fract(grid_uv * 4.0 - 0.5) - 0.5) / fwidth(grid_uv * 4.0);
    float line = min(grid.x, grid.y);
    float grid_pattern = 1.0 - smoothstep(0.0, 0.5, line);

    // Pulsing glow effect
    float pulse = sin(time * 2.0) * 0.5 + 0.5;
    float radial_dist = length(uv);
    float glow = exp(-radial_dist * 2.0) * pulse;

    // Colors: Cyan and Magenta
    vec3 color_a = vec3(0.0, 1.0, 1.0); // Cyan
    vec3 color_b = vec3(1.0, 0.0, 1.0); // Magenta
    vec3 grid_color = mix(color_a, color_b, uv.x * 0.5 + 0.5);

    // Final composition
    vec3 final_col = grid_pattern * grid_color;
    final_col += glow * color_b * 0.5; // Add magenta glow pulse

    // Dark background with a slight vignette
    float vignette = smoothstep(1.2, 0.4, radial_dist);
    final_col *= vignette;

    // Digital noise/grain
    float grain = fract(sin(dot(uv + time, vec2(12.9898, 78.233))) * 43758.5453) * 0.05;
    final_col += grain;

    fragColor = vec4(final_col, 1.0);
}
