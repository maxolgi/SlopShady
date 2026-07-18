// Name: Plasma Waves

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    vec2 p = uv * 6.0 - 3.0;
    float t = iTime * 0.8;

    float v1 = sin(p.x + t);
    float v2 = sin(p.y + t * 0.7);
    float v3 = sin(p.x + p.y + t * 0.5);
    float v4 = sin(length(p) * 1.5 - t * 1.2);
    float v5 = sin(sqrt(p.x * p.x + p.y * p.y + 1.0) + t);

    float v = (v1 + v2 + v3 + v4 + v5) * 0.2;

    vec3 col;
    col.r = sin(v * 3.14159 + 0.0) * 0.5 + 0.5;
    col.g = sin(v * 3.14159 + 2.094) * 0.5 + 0.5;
    col.b = sin(v * 3.14159 + 4.189) * 0.5 + 0.5;

    col = pow(col, vec3(0.85));

    fragColor = vec4(col, 1.0);
}
