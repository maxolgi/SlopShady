// Name: Mandelbrot
// Classic Mandelbrot set fractal with color cycling

vec3 palette(float t) {
    vec3 a = vec3(0.5, 0.5, 0.5);
    vec3 b = vec3(0.5, 0.5, 0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.263, 0.416, 0.557);
    return a + b * cos(6.28318 * (c * t + d));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    vec2 c = uv * 3.0 + vec2(-0.5, 0.0);

    // Slow zoom animation
    float zoom = 1.0 + 0.3 * sin(iTime * 0.2);
    c *= zoom;
    c += vec2(-0.5, 0.0);

    vec2 z = vec2(0.0);
    float iter = 0.0;
    const float maxIter = 80.0;

    for (float i = 0.0; i < 80.0; i++) {
        z = vec2(z.x * z.x - z.y * z.y, 2.0 * z.x * z.y) + c;
        if (dot(z, z) > 4.0) break;
        iter++;
    }

    if (iter >= maxIter) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
        return;
    }

    // Smooth iteration count for continuous coloring
    float smoothIter = iter - log2(log2(dot(z, z))) + 4.0;
    float t = smoothIter * 0.04 + iTime * 0.15;
    vec3 col = palette(t);

    fragColor = vec4(col, 1.0);
}
