// Name: Molten Lava Flow
// Molten Lava Flow
// A shader simulating flowing, glowing lava and cooling volcanic rock

float hash(vec2 p) {
    p = fract(p * vec2(127.1, 301.7)); // Small tweak to variety
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

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 6; ++i) {
        v += a * noise(p);
        p = p * 2.1 + vec2(0.5, 0.3);
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    uv = uv * 2.0 - 1.0;
    uv.x *= iResolution.x / iResolution.y;
    float time = iTime * 0.06;

    // Domain warping for lava motion
    vec2 q = vec2(fbm(uv + time), fbm(uv + vec2(1.5, 3.2) + time));
    vec2 r = vec2(fbm(uv + q + vec2(0.8, 2.1) + time * 0.5), fbm(uv + q + vec2(2.3, 5.7) + time * 0.8));
    float lava_density = fbm(uv + r);

    // Base color: Dark volcanic rock (#1a0500)
    vec3 col = vec3(0.05, 0.02, 0.01);

    // Lava colors: Bright orange and yellow highlights
    vec3 lava_hot = vec3(1.0, 0.7, 0.2);  // Yellow/Gold glow
    vec3 lava_mid = vec3(1.0, 0.3, 0.0);  // Deep Orange
    vec3 lava_cool = vec3(0.5, 0.05, 0.0); // Dark Red

    // Use the warped noise to define "cracks" and "flows"
    // Lava appears in high density areas of the fbm
    float crack_edge = smoothstep(0.45, 0.55, lava_density);
    float glow_area = smoothstep(0.3, 0.7, lava_density);

    // Mix colors based on density and warping
    vec3 flow_color = mix(lava_cool, lava_mid, glow_area);
    flow_color = mix(flow_color, lava_hot, crack_edge * 0.5);

    col = mix(col, flow_color, crack_edge);

    // Add a bright "heat" glow at the edges of the cracks
    float heat_glow = smoothstep(0.4, 0.6, lava_density) * (1.0 - crack_edge);
    col += lava_hot * heat_glow * 0.6;

    // Add some texture to the "rock" using r.x/r.y
    float rock_texture = noise(uv + r * 2.0);
    col *= (1.0 - 0.2 * rock_texture);

    // Final vignette and brightness control
    float vignette = smoothstep(1.5, 0.6, length(uv));
    col *= vignette;

    fragColor = vec4(col, 1.0);
}
