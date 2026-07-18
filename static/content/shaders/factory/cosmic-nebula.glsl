// Name: Cosmic Nebula
// Cosmic Nebula
// A swirling, colorful gas cloud in deep space with twinkling stars

float hash(vec2 p) {
    p = fract(p * vec2(127.1, 301.7));
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
        p = p * 2.0 + vec2(0.5, 0.3);
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    uv = uv * 2.0 - 1.0;
    uv.x *= iResolution.x / iResolution.y;
    float t = iTime * 0.05;

    // Nebula Clouds using Domain Warping
    vec2 q = vec2(fbm(uv + vec2(0.0, 0.0) + t), fbm(uv + vec2(5.2, 1.3) + t));
    vec2 r = vec2(fbm(uv + 4.0 * q + vec2(1.7, 9.2) + t * 0.5), fbm(uv + 4.0 * q + vec2(8.3, 2.8) + t * 0.3));
    float nebula_density = fbm(uv + 4.0 * r);

    // Color Palette: Deep space to vibrant cosmic colors
    vec3 deep_space = vec3(0.01, 0.01, 0.05); // Very dark blue
    vec3 purple_nebula = vec3(0.4, 0.1, 0.6);
    vec3 cyan_nebula = vec2(0.1, 0.7).xyx; // Teal/Cyan
    vec3 pink_nebula = vec3(0.9, 0.2, 0.5);

    // Layering colors based on density and warping
    vec3 col = mix(deep_space, purple_nebula, nebula_density);
    col = mix(col, cyan_nebula, clamp(r.x * 0.5, 0.0, 1.0) * nebula_density);
    col = mix(col, pink_nebula, clamp(r.y * 0.3, 0.0, 1.0) * (1.0 - nebula_density));

    // Add Stars
    float star_field = pow(hash(uv + t * 0.1), 500.0); // Tiny points
    // Let's use a more robust star method: high frequency noise thresholded
    float stars = smoothstep(0.998, 1.0, noise(uv * 100.0 + t * 0.02));
    // Twinkle effect
    float twinkle = sin(iTime * 2.0 + hash(uv) * 6.28) * 0.5 + 0.5;
    col += stars * twinkle * 0.8;

    // Add a soft cosmic glow/bloom
    float glow = smoothstep(0.3, 0.7, nebula_density);
    col += glow * vec3(0.2, 0.1, 0.4) * 0.5;

    // Final vignette to focus on the center
    float vignette = smoothstep(1.5, 0.5, length(uv));
    col *= vignette;

    fragColor = vec4(col, 1.0);
}
