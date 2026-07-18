// Name: Molten Magma Flow
// Molten Magma Flow
// A viscous, glowing shader simulating flowing lava with cooling crust textures

float hash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p.xy + 10.0);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 6; ++i) {
        v += a * noise(p);
        p = p * 1.8 + vec2(0.4, 0.3);
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    uv = uv * 2.0 - 1.0;
    uv.x *= iResolution.x / iResolution.y;
    float t = iTime * 0.1;

    // Domain Warping for viscous flow
    vec2 q = vec2(fbm(uv + t), fbm(uv + vec2(1.5, 3.2) + t));
    vec2 r = vec2(fbm(uv + q + vec2(0.8, 2.4) + t * 0.5), fbm(uv + q + vec2(3.1, 1.2) + t * 0.8));
    float f = fbm(uv + r);

    // Color Palette: Dark crust to bright molten lava
    vec3 dark_crust = vec3(0.05, 0.02, 0.01); // Deep burnt umber/black
    vec3 lava_red = vec3(0.6, 0.05, 0.0);   // Intense red
    vec3 lava_orange = vec3(1.0, 0.3, 0.0); // Bright orange
    vec3 lava_yellow = vec3(1.0, 0.8, 0.2); // Glowing yellow/white

    // Interpolate based on the noise value 'f'
    vec3 col = mix(dark_crust, lava_red, clamp(f * 2.5, 0.0, 1.0));
    col = mix(col, lava_orange, clamp(f * 4.0 - 1.0, 0.0, 1.0));
    col = mix(col, lava_yellow, clamp(f * 6.0 - 2.5, 0.0, 1.0));

    // Add "heat glow" effect: brighten the highest peaks
    float glow = smoothstep(0.6, 0.9, f);
    col += glow * vec3(0.4, 0.1, 0.0) * 0.5;

    // Subtle specular highlight for "wet" lava parts
    float spec = pow(smoothstep(0.7, 0.8, f), 20.0);
    col += spec * vec3(1.0, 0.6, 0.2) * 0.3;

    // Final adjustments: Vignette and contrast boost
    float vignette = smoothstep(1.5, 0.5, length(uv));
    col *= vignette;
    
    // Add a bit of "heat haze" grain
    float grain = (hash(uv + t * 0.5) - 0.5) * 0.04;
    col += grain;

    fragColor = vec4(col, 1.0);
}
