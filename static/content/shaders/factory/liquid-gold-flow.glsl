// Name: Liquid Gold Flow
// Liquid Gold Flow
// A shader simulating a flowing, metallic golden surface

// Simple 2D hash function
float hash(vec2 p) {
    p = fract(p * vec2(127.1, 33.3));
    return dot(p, p.xy + 10.0);
}

// Smooth noise function
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

// Fractal Brownian Motion (FBM)
float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 6; i++) {
        v += a * noise(p);
        p *= 2.1;
        a *= 0.5;
    }
    return v;
}

// Function to get height and normal
float getHeight(vec2 p, float time) {
    return fbm(p + time * 0.2);
}

vec3 getNormal(vec2 p, float time) {
    float e = 0.01;
    float h = getHeight(p, time);
    float h_x = getHeight(p + vec2(e, 0.0), time);
    float h_y = getHeight(p + vec2(0.0, e), time);
    return normalize(vec3(h - h_x, h - h_y, e));
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    uv = uv * 2.0 - 1.0;
    uv.x *= iResolution.x / iResolution.y;

    float time = iTime * 0.3;

    // Surface properties
    vec2 p = uv * 2.0;
    vec3 normal = getNormal(p, time);
    
    // Light source
    vec3 lightPos = normalize(vec3(sin(time)*0.5, cos(time)*0.5, 1.0));
    vec3 viewDir = vec3(0.0, 0.0, 1.0);
    vec3 reflectDir = reflect(-lightPos, normal);

    // Colors
    vec3 gold_base = vec3(0.8, 0.5, 0.1);
    vec3 gold_dark = vec3(0.4, 0.2, 0.0);
    vec3 highlight = vec3(1.0, 0.9, 0.6);

    // Diffuse lighting
    float diff = max(dot(normal, lightPos), 0.0);
    
    // Specular lighting (Phong)
    float spec = pow(max(dot(viewDir, reflectDir), 0.0), 32.0);
    
    // Combine components
    vec3 color = mix(gold_dark, gold_base, diff);
    color += highlight * spec * 1.5;
    
    // Add some "ripples" using the height
    float h = getHeight(p, time);
    color *= (0.8 + 0.2 * h);

    // Final touch: subtle vignette and bloom-like effect
    float vignette = smoothstep(1.5, 0.4, length(uv));
    color *= vignette;
    
    // Add a bit of "glow" by adding the specular back in a soft way
    color += highlight * spec * 0.3;

    fragColor = vec4(color, 1.0);
}
