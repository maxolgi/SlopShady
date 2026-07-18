// Name: Ethereal Aurora
// Ethereal Aurora
// Flowing ribbons of light in a dark, starry sky

float hash(vec2 p) {
    p = fract(p * vec2(127.1, 301.7));
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
        p = p * 2.0 + vec2(0.5, 0.3);
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    uv = uv * 2.0 - 1.0;
    uv.x *= iResolution.x / iResolution.y;
    float t = iTime * 0.3;

    // Background: Deep space dark blue/black
    vec3 col = vec3(0.01, 0.01, 0.05);

    // Star field
    float stars = pow(hash(uv + sin(iTime * 0.1)), 1000.0); // Very tiny points
    // A more reliable star method: high frequency noise thresholded
    float star_noise = noise(uv * 200.0 + t * 0.05);
    float star_field = smoothstep(0.998, 1.0, star_noise);
    col += star_field * 0.6;

    // Aurora Waves using FBM and Domain Warping
    vec2 aurora_uv = uv;
    aurora_uv.y -= 0.3; // Shift aurora down slightly
    
    float wave_1 = fbm(aurora_uv * 1.5 + vec2(t, t * 0.5));
    float wave_2 = fbm(aurora_uv * 2.5 - vec2(t * 0.8, t * 0.2));
    
    // Creating the ribbon effect with height-based coloring
    float aurora_height = sin(aurora_uv.y * 3.0 + wave_1 * 2.0 + wave_2 * 1.5);
    aurora_height = smoothstep(-0.8, 0.8, aurora_height);

    // Aurora Colors: Green, Cyan, Purple
    vec3 color_green = vec3(0.2, 0.9, 0.4);
    vec3 color_cyan  = vec3(0.1, 0.7, 0.8);
    vec3 color_purple = vec3(0.5, 0.2, 0.7);
    vec3 color_blue   = vec3(0.1, 0.2, 0.6);

    // Mix colors based on the aurora height and wave intensity
    vec3 aurora_col = mix(color_blue, color_green, wave_1);
    aurora_col = mix(aurora_col, color_cyan, wave_2 * 0.5);
    aurora_col = mix(aurora_col, color_purple, (1.0 - wave_1) * 0.3);

    // Add the aurora to the scene with glow and transparency
    float alpha = aurora_height * (0.4 + 0.6 * wave_1);
    col = mix(col, col + aurora_col, alpha);

    // Soft Glow effect
    float glow = smoothstep(0.2, 0.8, aurora_height) * 0.3;
    col += aurora_col * glow * (1.0 - abs(aurora_uv.y));

    // Vignette
    float vignette = smoothstep(1.5, 0.5, length(uv));
    col *= vignette;

    fragColor = vec4(col, 1.0);
}
