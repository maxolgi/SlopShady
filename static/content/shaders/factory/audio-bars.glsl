// Name: Audio Bars
// Classic bar-graph spectrum visualizer with glow and reflection

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    vec3 col = vec3(0.01, 0.01, 0.03);

    float barGap = 0.004;
    float maxHeight = 0.75;
    float baseY = 0.3;
    float numBars = 48.0;

    float fi = floor(uv.x * numBars);
    if (fi < 0.0 || fi >= numBars) {
        fragColor = vec4(col, 1.0);
        return;
    }

    float barLeft = fi / numBars + barGap * 0.5;
    float barRight = (fi + 1.0) / numBars - barGap * 0.5;

    float inBarX = step(barLeft, uv.x) * step(uv.x, barRight);
    if (inBarX < 0.5) {
        col += vec3(0.005, 0.005, 0.015) * step(baseY - 0.002, uv.y) * step(uv.y, baseY + 0.002);
        fragColor = vec4(col, 1.0);
        return;
    }

    float freqX = pow(fi / numBars, 2.0) * 0.95;
    float freq = texture(u_audioSpectrum, vec2(freqX, 0.5)).r;
    float barHeight = freq * maxHeight;
    float barTop = baseY + barHeight;

    float hue = fi / numBars + iTime * 0.03;
    vec3 barColor = hsv2rgb(vec3(hue, 0.8, 0.9));

    if (uv.y >= baseY && uv.y <= barTop) {
        float gradient = (uv.y - baseY) / max(barHeight, 0.001);
        col = barColor * (0.4 + gradient * 0.6);
    }

    float topGlow = exp(-abs(uv.y - barTop) * 40.0) * 0.5;
    col += barColor * topGlow;

    if (uv.y < baseY) {
        float reflection = (baseY - uv.y) / 0.25;
        float reflIntensity = exp(-reflection * 3.0) * 0.15;
        col += barColor * reflIntensity * step(0.0, barHeight);
    }

    col = clamp(col, 0.0, 1.0);
    fragColor = vec4(col, 1.0);
}
