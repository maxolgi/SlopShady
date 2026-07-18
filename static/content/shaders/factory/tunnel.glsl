// Name: Tunnel

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime * 0.5;

    float angle = atan(uv.y, uv.x);
    float radius = length(uv);

    float tunnel = 0.3 / (radius + 0.001);
    float u = angle / 3.14159;
    float v = tunnel - t * 2.0;

    float pattern = sin(u * 12.0) * sin(v * 6.0);
    pattern = 0.5 + 0.5 * pattern;

    vec3 col;
    col.r = 0.5 + 0.5 * sin(pattern * 3.0 + t);
    col.g = 0.5 + 0.5 * sin(pattern * 3.0 + t + 2.0);
    col.b = 0.5 + 0.5 * sin(pattern * 3.0 + t + 4.0);

    col *= 1.0 / (radius * 4.0 + 1.0);

    fragColor = vec4(col, 1.0);
}
