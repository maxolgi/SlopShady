// Name: Audio Ring
// Circular audio spectrum visualization using frequency data

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    vec3 col = vec3(0.01, 0.01, 0.03);

    float innerRadius = 0.15;
    float maxBarHeight = 0.35;

    float dist = length(uv);
    float angle = atan(uv.y, uv.x);
    float normAngle = (angle + 3.14159265) / 6.28318;

    for (int i = 0; i < 64; i++) {
        float fi = float(i);
        float barAngle = fi / 64.0;
        float halfWidth = 0.006;

        float angleDist = abs(normAngle - barAngle);
        angleDist = min(angleDist, 1.0 - angleDist);
        float inBar = smoothstep(halfWidth + 0.004, halfWidth, angleDist);

        float freqX = pow(barAngle, 2.0) * 0.95;
        float freq = texture(u_audioSpectrum, vec2(freqX, 0.5)).r;
        float barHeight = freq * maxBarHeight;
        float outerEdge = innerRadius + barHeight;

        float radialMask = smoothstep(outerEdge + 0.005, outerEdge - 0.005, dist)
                         * smoothstep(innerRadius - 0.005, innerRadius + 0.005, dist);

        float hue = barAngle + iTime * 0.05;
        vec3 barColor = hsv2rgb(vec3(hue, 0.7, 0.9));
        col += barColor * inBar * radialMask;
    }

    float ring = smoothstep(0.004, 0.0, abs(dist - innerRadius));
    col += vec3(0.15, 0.2, 0.3) * ring;

    float centerGlow = exp(-dist * 8.0) * 0.08;
    col += vec3(0.1, 0.15, 0.25) * centerGlow;

    fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
