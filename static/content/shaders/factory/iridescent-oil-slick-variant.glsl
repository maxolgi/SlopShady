// Name: Iridescent Oil Slick
// Iridescent Oil Slick
// A fluid, swirling shader simulating thin-film interference colors on an oil surface

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
        p = p * 2.1 + vec2(0.5, 0.3);
        a *= 0.5;
    }
    return v;
}

// Function to create an iridescent color ramp based on a single value
vec3 iridescence(float t) {
    vec3 col = vec3(0.0);
    // We'll use several overlapping sine waves of different hues to simulate the spectrum
    col += 0.5 * sin(6.28 * (t + 0.00) + 0.00) * vec3(1.0, 0.0, 0.0); // Red
    col += 0.5 * sin(6.28 * (t + 0.33) + 0.00) * vec3(0.0, 1.0, 0.0); // Green
    col += 0.5 * sin(6.28 * (t + 0.67) + 0.00) * vec3(0.0, 0.0, 1.0); // Blue
    return col / 1.5; // Normalize
}

// A more robust color ramp using a smoother approach
vec3 rainbow_ramp(float t) {
    vec3 col = vec3(0.0);
    col += vec3(1.0, 0.0, 0.0) * smoothstep(0.0, 0.25, t) * (1.0 - smoothstep(0.0, 0.25, t));
    col += vec3(0.0, 1.0, 0.0) * smoothstep(0.25, 0.5, t) * (1.0 - smoothstep(0.25, 0.5, t));
    col += vec3(0.0, 0.0, 1.0) * smoothstep(0.5, 0.75, t) * (1.0 - smoothstep(0.5, 0.75, t));
    // Adding some yellow and cyan for richness
    col += vec3(1.0, 1.0, 0.0) * smoothstep(0.125, 0.375, t) * (1.0 - smoothstep(0.125, 0.375, t));
    col += vec3(0.0, 1.0, 1.0) * smoothstep(0.375, 0.625, t) * (1.0 - smoothstep(0.375, 0.625, t));
    return col;
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    uv = uv * 2.0 - 1.0;
    uv.x *= iResolution.x / iResolution.y;
    float t = iTime * 0.15;

    // Domain warping for fluid motion
    vec2 q = vec2(fbm(uv + t), fbm(uv + vec2(1.2, 3.4) + t));
    vec2 r = vec2(fbm(uv + q + vec2(0.5, 1.5) + t * 0.5), fbm(uv + q + vec2(2.1, 6.7) + t * 0.8));
    float f = fbm(uv + r);

    // The "oil" base color - dark and reflective
    vec3 col = vec3(0.05, 0.05, 0.08);

    // Apply the iridescence based on the warped noise structure
    // We use 'f' as our parameter for the spectrum
    vec3 iris = rainbow_ramp(f * 0.5 + 0.2);
    col = mix(col, iris, 0.7);

    // Add specular highlights to simulate a wet/oily surface
    float spec = pow(smoothstep(0.4, 0.5, f), 10.0);
    col += spec * 0.4; // Bright white highlight

    // Subtle dark swirls for depth
    col *= (1.0 - 0.3 * r.x);

    // Final vignette and brightness boost
    float vignette = smoothstep(1.5, 0.5, length(uv));
    col *= vignette;
    
    // Add a bit of "sheen" or glare
    float sheen = smoothstep(0.2, 0.8, f) * 0.1;
    col += sheen;

    fragColor = vec4(col, 1.0);
}
