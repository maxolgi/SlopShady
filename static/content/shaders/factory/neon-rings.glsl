// Name: Neon Rings

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime;

    vec3 col = vec3(0.0);

    for (int i = 0; i < 6; i++) {
        float fi = float(i);
        float radius = 0.1 + fi * 0.12;
        float expand = sin(t * (0.8 + fi * 0.2) + fi) * 0.05;
        float r = radius + expand;

        float dist = abs(length(uv) - r);
        float glow = 0.004 / (dist + 0.004);
        glow = pow(glow, 1.2);

        vec3 ringCol;
        ringCol.r = 0.5 + 0.5 * sin(fi * 1.5 + t * 0.7);
        ringCol.g = 0.5 + 0.5 * sin(fi * 1.5 + t * 0.7 + 2.094);
        ringCol.b = 0.5 + 0.5 * sin(fi * 1.5 + t * 0.7 + 4.189);

        col += ringCol * glow * 0.3;
    }

    vec2 center = vec2(0.0);
    float coreDist = length(uv - center);
    float core = 0.005 / (coreDist + 0.005);
    col += vec3(1.0, 0.9, 0.8) * core * 0.2;

    fragColor = vec4(col, 1.0);
}
