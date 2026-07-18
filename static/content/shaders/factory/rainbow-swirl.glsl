// Name: Rainbow Swirl
// Rainbow spiral using polar coordinates and hue cycling

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;

    float r = length(uv);
    float a = atan(uv.y, uv.x);

    // Spiral: angle offset increases with radius and time
    float spiral = a / 6.28318 + r * 3.0 - iTime * 0.5;
    float arms = 5.0;
    float pattern = sin(spiral * arms * 6.28318) * 0.5 + 0.5;

    // Hue based on spiral position + time cycling
    float hue = fract(spiral * 0.5 + iTime * 0.1);
    float sat = 0.8 + 0.2 * pattern;
    float val = 0.6 + 0.4 * pattern;

    vec3 col = hsv2rgb(vec3(hue, sat, val));

    // Darken towards center and edges
    float vignette = smoothstep(0.0, 0.1, r) * smoothstep(0.8, 0.3, r);
    col *= vignette;

    // Glow at center
    col += vec3(0.2, 0.1, 0.3) * exp(-r * 5.0);

    fragColor = vec4(col, 1.0);
}
