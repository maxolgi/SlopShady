// Name: Mod Playground
// Domain-warped pattern with many extractable parameters for modulation testing

vec3 palette(float t, float shift, float richness) {
    vec3 a = vec3(0.5, 0.3, 0.4);
    vec3 b = vec3(0.5, 0.4, 0.3) * richness;
    vec3 c = vec3(1.0, 0.8, 0.7);
    vec3 d = vec3(shift, shift + 0.11, shift + 0.23);
    return a + b * cos(6.28318 * (c * t + d));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;

    float speed = 0.25;
    float t = iTime * speed;

    float zoom = 3.5;
    vec2 p = uv * zoom;

    float warpAmt = 0.35;
    float warpFreq = 2.7;

    for (float j = 1.0; j < 4.0; j += 1.0) {
        p.x += warpAmt / j * sin(j * warpFreq * p.y + t);
        p.y += warpAmt / j * cos(j * warpFreq * p.x + t);
    }

    float strength = 7.5;
    float d = 0.0;
    vec2 grid = p * strength;

    for (float j = 0.0; j < 3.0; j += 1.0) {
        grid = abs(grid) / dot(grid, grid) - 0.72;
        d += length(grid) * 0.15;
    }

    float palShift = 0.33;
    float richness = 1.4;
    vec3 col = palette(length(p) * 0.45 + d * 0.18, palShift, richness);

    float glowAmt = 0.85;
    float pulse = sin(d * 10.5 - t * 2.3);
    float glow = smoothstep(0.12, 0.0, abs(pulse)) * glowAmt;
    col += vec3(0.8, 0.9, 1.0) * glow;

    float brightness = 0.85;
    col *= brightness;

    float vignette = 1.25 - length(uv);
    col *= max(vignette, 0.0);

    col = clamp(col, 0.0, 1.0);
    fragColor = vec4(col, 1.0);
}
