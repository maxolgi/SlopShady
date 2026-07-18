// Name: Grid Pulse
// Animated grid with distance-based wave pulsing

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;

    float gridSize = 10.0;
    vec2 gridUV = uv * gridSize;

    // Distance from center for wave
    float dist = length(uv);

    // Animated wave
    float wave = sin(dist * 12.0 - iTime * 4.0) * 0.5 + 0.5;

    // Grid lines
    vec2 grid = abs(fract(gridUV) - 0.5);
    float lineX = smoothstep(0.03, 0.0, grid.x);
    float lineY = smoothstep(0.03, 0.0, grid.y);
    float lines = max(lineX, lineY);

    // Grid intersections brighter
    float intersections = smoothstep(0.06, 0.0, length(grid)) * 1.5;

    // Cell coloring based on wave
    vec2 cell = floor(gridUV);
    float cellH = fract(sin(dot(cell, vec2(127.1, 311.7))) * 43758.5453);
    float pulse = sin(dist * 10.0 - iTime * 3.0 + cellH * 3.0) * 0.5 + 0.5;

    // Colors
    vec3 lineColor = vec3(0.1, 0.6, 0.9) * (0.3 + wave * 0.7);
    vec3 intersectColor = vec3(0.3, 0.9, 1.0) * pulse;
    vec3 cellColor = vec3(0.02, 0.05, 0.1) * pulse;
    vec3 bgColor = vec3(0.01, 0.01, 0.03);

    vec3 col = bgColor + cellColor + lineColor * lines + intersectColor * intersections * 0.5;

    // Distance fade
    col *= 1.0 - smoothstep(0.4, 1.0, dist);

    fragColor = vec4(col, 1.0);
}
