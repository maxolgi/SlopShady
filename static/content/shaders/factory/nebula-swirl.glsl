// Name: Nebula Swirl
// Nebula Swirl
// A shader featuring swirling cosmic clouds with deep blues, purples, and golden stars

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    uv = uv * 2.0 - 1.0;
    uv.x *= iResolution.x / iResolution.y;

    float time = iTime * 0.1;

    // Domain warping for fluid-like movement
    vec2 q = vec2(0.0);
    q.x = 0.5 * sin(uv.y + time + 0.3 * sin(time));
    q.y = 0.5 * cos(uv.x + time + 0.4 * cos(time));

    vec2 r = vec2(0.0);
    r.x = 0.5 * sin(uv.y + q.x + time + 0.3 * sin(time) + 0.1);
    r.y = 0.5 * cos(uv.x + q.y + time + 0.4 * cos(time) + 0.2);

    float f = 0.5 * sin(uv.x + r.x + time);
    // Simplified noise-like effect using sine waves and domain warping
    float pattern = sin(uv.x * 3.0 + r.x * 2.0 + q.y * 1.5) * 
                    sin(uv.y * 3.0 + r.y * 2.0 + q.x * 1.5);

    // Colors: Deep space, purple, and magenta nebula clouds
    vec3 color_bg = vec3(0.02, 0.01, 0.05); // Very dark purple/black
    vec3 color_nebula_a = vec3(0.2, 0.0, 0.4); // Deep purple
    vec3 color_nebula_b = vec3(0.5, 0.0, 0.5); // Magenta

    vec3 nebula_color = mix(color_nebula_a, color_nebula_b, pattern * 0.5 + 0.5);
    
    // Add some glow/intensity to the nebula clouds
    float intensity = pow(pattern * 0.5 + 0.5, 3.0);
    vec3 final_col = mix(color_bg, nebula_color, intensity);

    // Adding golden stars
    float star_noise = fract(sin(dot(uv + time * 0.01, vec2(12.9898, 78.233))) * 43758.5453);
    // Create a few prominent twinkling stars using a pseudo-random approach
    float star_pattern = sin(uv.x * 100.0 + uv.y * 100.0 + time) * sin(uv.x * 50.0 - uv.y * 30.0);
    // We'll use a simpler approach for stars: random dots based on UV
    float star_threshold = 0.998;
    float twinkle = abs(sin(time + star_noise * 10.0)) * 0.5 + 0.5;
    
    // Use a pseudo-random function to place stars
    vec2 star_uv = uv * 50.0;
    float star_rand = fract(sin(dot(floor(star_uv), vec2(12.9898, 78.233))) * 43758.5453);
    if (star_rand > star_threshold) {
        final_col += vec3(1.0, 0.8, 0.4) * twinkle; // Golden stars
    }

    // Final vignette and brightness adjustment
    float vignette = smoothstep(1.5, 0.5, length(uv));
    final_col *= vignette;

    fragColor = vec4(final_col, 1.0);
}
