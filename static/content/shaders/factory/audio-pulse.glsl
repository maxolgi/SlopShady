// Name: Audio Pulse
// Concentric rings pulsing with audio energy from frequency bands

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    vec3 col = vec3(0.01, 0.01, 0.03);

    float bass = texture(u_audioSpectrum, vec2(0.05, 0.5)).r;
    float mid = texture(u_audioSpectrum, vec2(0.25, 0.5)).r;
    float high = texture(u_audioSpectrum, vec2(0.6, 0.5)).r;

    float baseRadius = 0.05;
    float ringSpacing = 0.1;
    float ringWidth = 0.005;
    float ringExpand = 0.2;

    for (int i = 0; i < 8; i++) {
        float fi = float(i);
        float radius = baseRadius + fi * ringSpacing;

        float band;
        vec3 ringColor;
        if (fi < 3.0) {
            band = bass;
            ringColor = hsv2rgb(vec3(0.0, 0.8, 1.0));
        } else if (fi < 6.0) {
            band = mid;
            ringColor = hsv2rgb(vec3(0.33, 0.8, 1.0));
        } else {
            band = high;
            ringColor = hsv2rgb(vec3(0.55, 0.8, 1.0));
        }

        float animatedR = radius + band * ringExpand;
        float dist = length(uv);
        float ring = exp(-pow((dist - animatedR) / ringWidth, 2.0));

        float decay = 1.0 - fi * 0.1;
        col += ringColor * ring * band * decay * 0.8;
    }

    float centerGlow = exp(-length(uv) * 10.0) * bass * 0.4;
    col += vec3(0.3, 0.1, 0.4) * centerGlow;

    col = clamp(col, 0.0, 1.0);
    fragColor = vec4(col, 1.0);
}
