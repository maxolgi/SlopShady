// Name: Lightning
// Procedural lightning bolts with glow effect

float hash(float n) {
    return fract(sin(n) * 43758.5453);
}

float bolt(vec2 uv, vec2 a, vec2 b, float seed) {
    float d = 1e10;
    vec2 prev = a;
    float segments = 8.0;
    for (float i = 1.0; i <= 8.0; i++) {
        float t = i / segments;
        vec2 next = mix(a, b, t);
        // Jagged offset perpendicular to bolt direction
        vec2 dir = normalize(b - a);
        vec2 perp = vec2(-dir.y, dir.x);
        float jitter = (hash(seed + i * 17.0) - 0.5) * 0.25;
        if (i > 0.5 && i < segments - 0.5) next += perp * jitter;

        // Distance to segment
        vec2 pa = uv - prev;
        vec2 ba = next - prev;
        float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
        d = min(d, length(pa - ba * h));

        prev = next;
    }
    return d;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;

    vec3 col = vec3(0.01, 0.01, 0.04); // dark sky

    // Multiple bolts with different seeds over time
    for (int i = 0; i < 4; i++) {
        float fi = float(i);
        float t = floor(iTime * 1.5 + fi * 3.7);
        float seed = t + fi * 100.0;

        float x1 = hash(seed) * 1.6 - 0.8;
        float x2 = hash(seed + 1.0) * 1.6 - 0.8;
        vec2 start = vec2(x1, 0.55);
        vec2 end = vec2(x2, -0.55);

        float d = bolt(uv, start, end, seed);

        // Bright core with glow falloff
        float intensity = 0.003 / (d * d + 0.001);
        vec3 boltColor = vec3(0.6, 0.7, 1.0);
        col += boltColor * intensity * 0.008;

        // Branch
        float branchStart = 0.3 + hash(seed + 50.0) * 0.3;
        vec2 branchA = mix(start, end, branchStart);
        vec2 branchB = branchA + vec2((hash(seed + 51.0) - 0.5) * 0.5, -0.2 - hash(seed + 52.0) * 0.2);
        float db = bolt(uv, branchA, branchB, seed + 200.0);
        float bi = 0.002 / (db * db + 0.001);
        col += boltColor * bi * 0.004;
    }

    // Ambient flash
    float flash = 0.01 * pow(max(0.0, sin(iTime * 5.0)), 20.0);
    col += vec3(0.3, 0.3, 0.5) * flash;

    fragColor = vec4(col, 1.0);
}
