// Name: Hex Tiles
// Hexagonal tiling pattern with animated coloring

vec2 hexCenter(vec2 p) {
    // Hex grid: pointy-top
    vec2 s = vec2(1.0, 1.732);
    vec2 h = s * 0.5;
    vec2 a = mod(p, s) - h;
    vec2 b = mod(p + h, s) - h;
    vec2 gv = dot(a, a) < dot(b, b) ? a : b;
    return p - gv;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;

    float scale = 6.0;
    vec2 p = uv * scale;

    // Find nearest hex center
    vec2 hc = hexCenter(p);
    vec2 diff = p - hc;
    float distToCenter = length(diff);

    // Cell hash for unique color
    float h = fract(sin(dot(hc, vec2(127.1, 311.7))) * 43758.5453);
    float h2 = fract(sin(dot(hc, vec2(269.5, 183.3))) * 43758.5453);

    // Animated hue
    float hue = fract(h + iTime * 0.05);

    // HSV to RGB (inline)
    vec3 rgb = 0.5 + 0.5 * cos(6.28318 * (hue + vec3(0.0, 0.33, 0.67)));
    float brightness = 0.6 + 0.4 * sin(iTime * (0.5 + h2) + h * 6.28);

    vec3 tileColor = rgb * brightness;

    // Hex border: darken edges
    float hexRadius = 0.45;
    float border = smoothstep(hexRadius, hexRadius - 0.05, distToCenter);

    // Outline glow
    float outline = smoothstep(0.48, 0.43, distToCenter) - smoothstep(0.43, 0.38, distToCenter);
    vec3 outlineColor = vec3(0.3, 0.6, 1.0) * (0.3 + 0.3 * sin(iTime * 2.0 + h * 10.0));

    vec3 col = tileColor * border + outlineColor * outline * 0.6;
    col += vec3(0.02) * (1.0 - border); // gap color

    fragColor = vec4(col, 1.0);
}
