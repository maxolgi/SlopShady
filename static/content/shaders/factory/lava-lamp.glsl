// Name: Lava Lamp
// Metaball/lava lamp with smooth blending of animated blobs

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;

    float d = 1e10;

    // Animated blobs
    for (int i = 0; i < 5; i++) {
        float fi = float(i);
        float angle = fi * 1.2566 + iTime * (0.3 + fi * 0.05);
        float radius = 0.25 + 0.1 * sin(iTime * 0.5 + fi * 2.0);
        float size = 0.15 + 0.05 * sin(iTime * 0.7 + fi);

        vec2 blobPos = vec2(cos(angle), sin(angle * 0.7 + fi)) * radius;
        float dist = length(uv - blobPos) - size;
        d = min(d, dist);
    }

    // Central large blob
    float centralDist = length(uv - vec2(0.0, 0.15 * sin(iTime * 0.4))) - 0.22;
    d = min(d, centralDist);

    // Smooth edge
    float edge = smoothstep(0.02, -0.02, d);
    float glow = exp(-max(d, 0.0) * 6.0);

    // Lava color palette: deep red -> orange -> yellow
    vec3 lavaInner = vec3(1.0, 0.85, 0.2);
    vec3 lavaMid = vec3(1.0, 0.3, 0.05);
    vec3 lavaOuter = vec3(0.4, 0.05, 0.0);

    float t = 0.5 + 0.5 * sin(length(uv) * 5.0 - iTime * 2.0);
    vec3 lavaColor = mix(lavaOuter, lavaMid, t);
    lavaColor = mix(lavaColor, lavaInner, smoothstep(0.0, -0.1, d));

    vec3 bgColor = vec3(0.02, 0.0, 0.03);

    vec3 col = bgColor;
    col += lavaColor * edge;
    col += lavaMid * glow * 0.4;

    fragColor = vec4(col, 1.0);
}
