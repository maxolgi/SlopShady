// Name: Mosaic
// Mosaic/tile pattern with quantized UV coordinates and borders

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;

    float tiles = 12.0;
    vec2 cell = floor(uv * tiles);
    vec2 f = fract(uv * tiles);

    // Hash per cell for varied colors
    float h = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
    float h2 = fract(sin(dot(cell, vec2(269.5, 183.3))) * 43758.5453);

    vec3 baseColor = 0.5 + 0.5 * cos(iTime * 0.5 + h * 6.28 + vec3(0.0, 2.0, 4.0));

    // Darken based on distance from cell center
    float dist = length(f - 0.5);
    baseColor *= 0.7 + 0.3 * (1.0 - dist * 1.5);

    // Border: thin dark lines at cell edges
    float border = smoothstep(0.0, 0.06, f.x) * smoothstep(0.0, 0.06, f.y)
                 * smoothstep(0.0, 0.06, 1.0 - f.x) * smoothstep(0.0, 0.06, 1.0 - f.y);

    // Gap between tiles
    float gap = smoothstep(0.02, 0.04, f.x) * smoothstep(0.02, 0.04, f.y)
              * smoothstep(0.02, 0.04, 1.0 - f.x) * smoothstep(0.02, 0.04, 1.0 - f.y);

    vec3 col = baseColor * gap + vec3(0.1) * (1.0 - gap);

    // Subtle shimmer animation
    float shimmer = 0.05 * sin(iTime * 2.0 + h2 * 20.0);
    col += shimmer;

    fragColor = vec4(col, 1.0);
}
