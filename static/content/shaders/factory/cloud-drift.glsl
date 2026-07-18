// Name: Cloud Drift
// FBM noise-based drifting clouds

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
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
    float val = 0.0;
    float amp = 0.5;
    float freq = 1.0;
    for (int i = 0; i < 5; i++) {
        val += amp * noise(p * freq);
        freq *= 2.0;
        amp *= 0.5;
    }
    return val;
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;

    // Scroll UVs for drifting effect
    vec2 drift = vec2(iTime * 0.03, iTime * 0.01);
    float n = fbm(uv * 4.0 + drift);
    float n2 = fbm(uv * 6.0 - drift * 1.5 + 10.0);

    // Cloud density
    float cloud = n * 0.6 + n2 * 0.4;
    cloud = smoothstep(0.35, 0.75, cloud);

    // Sky gradient
    vec3 skyTop = vec3(0.2, 0.4, 0.8);
    vec3 skyBot = vec3(0.6, 0.75, 0.95);
    vec3 sky = mix(skyBot, skyTop, uv.y);

    // Cloud colors
    vec3 cloudLight = vec3(1.0, 1.0, 1.05);
    vec3 cloudShadow = vec3(0.5, 0.55, 0.7);
    vec3 cloudCol = mix(cloudShadow, cloudLight, n);

    vec3 col = mix(sky, cloudCol, cloud);

    // Subtle sunlight glow
    float sun = exp(-length((uv - vec2(0.7, 0.8)) * vec2(1.5, 2.0)) * 3.0);
    col += vec3(1.0, 0.9, 0.7) * sun * 0.3;

    fragColor = vec4(col, 1.0);
}
