// Name: Kaleidoscope

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime * 0.2;

    float angle = atan(uv.y, uv.x);
    float radius = length(uv);

    float segments = 8.0;
    angle = mod(angle, 2.0 * 3.14159 / segments);
    angle = abs(angle - 3.14159 / segments);

    vec2 p = vec2(cos(angle), sin(angle)) * radius;
    p += t;

    float r = sin(p.x * 10.0 + t * 3.0) * cos(p.y * 8.0 - t * 2.0);
    r += sin(radius * 20.0 - t * 4.0) * 0.3;

    vec3 col;
    col.r = 0.5 + 0.5 * sin(r * 3.0 + 0.0);
    col.g = 0.5 + 0.5 * sin(r * 3.0 + 2.0);
    col.b = 0.5 + 0.5 * sin(r * 3.0 + 4.0);

    col *= 0.5 + 0.5 * smoothstep(0.0, 0.7, radius);

    fragColor = vec4(col, 1.0);
}
