// Name: Liquid Neon Fluid
// Liquid Neon Fluid
// A smooth, flowing shader with bioluminescent colors and organic motion

float hash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
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
    for (int i = 0; i < 5; ++i) {
        v += a * noise(p);
        p = p * 2.0 + vec2(0.5, 0.3);
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    uv = uv * 2.0 - 1.0; // Center and scale UVs
    float t = iTime * 0.3;

    // Domain Warping: Distort the UV coordinates using FBM
    vec2 q = vec2(fbm(uv + t), fbm(uv + vec2(1.0, 0.5) + t));
    vec2 r = vec2(fbm(uv + q + vec2(1.7, 9.2) + 0.15 * t), fbm(uv + q + vec2(8.3, 2.8) + 0.126 * t));
    float f = fbm(uv + r);

    // Create a vibrant color palette based on the warped noise
    vec3 col = mix(vec3(0.0, 0.1, 0.2), // Deep ocean blue
                   vec3(0.1, 0.8, 0.6), // Teal/Cyan
                   clamp(f * f * 4.0, 0.0, 1.0));

    col = mix(col,
              vec3(0.9, 0.2, 0.5), // Magenta/Pink
              clamp(length(q), 0.0, 1.0) * 0.5);

    col = mix(col,
              vec3(0.2, 0.4, 1.0), // Electric Blue
              clamp(length(r.x), 0.0, 1.0) * 0.5);

    // Add a glowing/bloom effect by boosting brightness in high-noise areas
    col += (f * f) * vec3(0.2, 0.6, 1.0) * 0.4;

    // Final color adjustment: contrast and vignette
    float vignette = smoothstep(1.5, 0.5, length(uv));
    col *= vignette;
    
    fragColor = vec4(col, 1.0);
}
