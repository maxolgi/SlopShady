// Name: Fractal Noise

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
    float v = 0.0;
    float a = 0.5;
    mat2 rot = mat2(0.8, 0.6, -0.6, 0.8);
    for (int i = 0; i < 6; i++) {
        v += a * noise(p);
        p = rot * p * 2.0;
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    vec2 p = uv * 4.0;
    float t = iTime * 0.15;

    float n = fbm(p + fbm(p + t));

    vec3 col = vec3(0.0);
    col += vec3(0.1, 0.3, 0.6) * smoothstep(0.0, 0.4, n);
    col += vec3(0.2, 0.7, 0.3) * smoothstep(0.3, 0.6, n);
    col += vec3(0.9, 0.8, 0.2) * smoothstep(0.5, 0.8, n);
    col += vec3(1.0, 1.0, 1.0) * smoothstep(0.7, 1.0, n);

    fragColor = vec4(col, 1.0);
}
