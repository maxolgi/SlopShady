// Name: Aurora
// Aurora borealis with layered sine curtains and gradient coloring

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;

    vec3 col = vec3(0.0);

    // Layered aurora curtains
    for (float i = 0.0; i < 5.0; i++) {
        float offset = i * 0.4;
        float speed = 0.3 + i * 0.1;
        float freq = 3.0 + i * 0.5;

        // Horizontal wave displacement
        float wave = sin(uv.x * freq + iTime * speed + offset) * 0.15;
        wave += sin(uv.x * freq * 1.5 - iTime * speed * 0.7 + offset * 2.0) * 0.08;

        // Vertical curtain shape
        float y = uv.y + 0.1 * i;
        float curtain = exp(-pow(y - wave - 0.2, 2.0) * (8.0 + i * 2.0));

        // Color gradient per layer
        vec3 auroraColor;
        if (i < 2.0) {
            auroraColor = vec3(0.1, 0.8, 0.3); // Green
        } else if (i < 3.5) {
            auroraColor = vec3(0.2, 0.5, 0.9); // Blue
        } else {
            auroraColor = vec3(0.6, 0.2, 0.8); // Purple
        }

        col += curtain * auroraColor * (0.6 - i * 0.08);
    }

    // Dark sky background
    vec3 sky = vec3(0.02, 0.02, 0.06);
    col += sky;

    // Subtle stars
    float star = step(0.998, fract(sin(dot(floor(gl_FragCoord.xy / 2.0), vec2(12.9898, 78.233))) * 43758.5453));
    col += star * 0.5;

    fragColor = vec4(col, 1.0);
}
