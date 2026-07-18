// Name: Ocean Waves

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    vec2 p = uv * vec2(6.0, 3.0);
    float t = iTime;

    float wave1 = sin(p.x * 2.0 + t * 1.2) * 0.15;
    float wave2 = sin(p.x * 3.5 - t * 0.8 + 1.0) * 0.1;
    float wave3 = sin(p.x * 7.0 + t * 2.0 + 2.0) * 0.04;
    float wave4 = sin(p.x * 1.0 + p.y * 2.0 + t * 0.6) * 0.08;

    float surface = wave1 + wave2 + wave3 + wave4;
    float y = uv.y - 0.4 - surface;

    vec3 sky = vec3(0.4, 0.6, 0.9);
    vec3 deep = vec3(0.0, 0.05, 0.15);
    vec3 mid = vec3(0.0, 0.15, 0.35);
    vec3 shallow = vec3(0.1, 0.35, 0.5);
    vec3 foam = vec3(0.7, 0.85, 0.95);

    vec3 col = sky;

    if (y < 0.0) {
        float depth = -y;
        col = mix(shallow, mid, smoothstep(0.0, 0.2, depth));
        col = mix(col, deep, smoothstep(0.2, 0.5, depth));

        float caustic = sin(p.x * 10.0 + t * 2.0) * sin(p.y * 12.0 - t * 1.5);
        col += vec3(0.05, 0.1, 0.15) * caustic * (1.0 - smoothstep(0.0, 0.3, depth));

        float foamLine = smoothstep(-0.01, 0.01, y + 0.02 * sin(p.x * 15.0 + t * 3.0));
        col = mix(col, foam, (1.0 - foamLine) * smoothstep(-0.05, 0.0, y));
    }

    fragColor = vec4(col, 1.0);
}
