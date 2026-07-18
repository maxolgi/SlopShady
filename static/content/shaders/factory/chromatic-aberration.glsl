// Name: Chromatic Aberration
// RGB channel splitting with distortion

vec2 distort(vec2 uv, float amount) {
    float r = length(uv);
    float a = atan(uv.y, uv.x);
    // Spiral distortion
    float twist = amount * sin(r * 4.0 - iTime * 1.5);
    a += twist;
    r += 0.02 * sin(a * 3.0 + iTime * 2.0);
    return vec2(cos(a), sin(a)) * r;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    vec2 uvNorm = gl_FragCoord.xy / iResolution.xy;

    float dist = length(uv);
    float aberration = 0.02 + dist * 0.08;

    // Distort UVs differently per channel
    vec2 uvR = distort(uv, aberration * 1.0);
    vec2 uvG = distort(uv, aberration * 0.3);
    vec2 uvB = distort(uv, -aberration * 0.8);

    // Pattern per channel: concentric rings
    float ringsR = sin(length(uvR) * 30.0 - iTime * 3.0) * 0.5 + 0.5;
    float ringsG = sin(length(uvG) * 30.0 - iTime * 3.0 + 2.0) * 0.5 + 0.5;
    float ringsB = sin(length(uvB) * 30.0 - iTime * 3.0 + 4.0) * 0.5 + 0.5;

    // Radial stripes
    float stripesR = sin(atan(uvR.y, uvR.x) * 8.0 + iTime) * 0.5 + 0.5;
    float stripesG = sin(atan(uvG.y, uvG.x) * 8.0 + iTime) * 0.5 + 0.5;
    float stripesB = sin(atan(uvB.y, uvB.x) * 8.0 + iTime) * 0.5 + 0.5;

    float r = ringsR * stripesR;
    float g = ringsG * stripesG;
    float b = ringsB * stripesB;

    // Center glow
    float glow = exp(-dist * 3.0);
    r += glow * 0.5;
    g += glow * 0.8;
    b += glow * 1.0;

    // Vignette
    float vig = 1.0 - smoothstep(0.3, 0.9, dist);

    vec3 col = vec3(r, g, b) * vig;
    col += vec3(0.02);

    fragColor = vec4(col, 1.0);
}
