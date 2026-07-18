// Name: Neon Aurora
// Neon Aurora
// A shader simulating flowing, luminous ribbons of light in a dark void

// Simple 2D noise function (pseudo-Perlin)
float noise(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

// Smooth noise function for better gradients
float smooth_noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    
    float a = noise(i);
    float b = noise(i + vec2(1.0, 0.0));
    float c = noise(i + vec2(0.0, 1.0));
    float d = noise(i + vec2(1.0, 1.0));
    
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Function to create flowing ribbons using layered noise
vec3 aurora_ribbons(vec2 uv, float time) {
    vec2 p = uv * 2.0 - 1.0;
    p.x *= iResolution.x / iResolution.y;
    
    float intensity = 0.0;
    vec3 color = vec3(0.0);
    
    // Layered noise for the "ribbon" effect
    for (int i = 1; i <= 4; i++) {
        float scale = float(i) * 0.5;
        float speed = float(i) * 0.2;
        
        vec2 motion = vec2(time * speed, time * speed * 0.5);
        float n = smooth_noise(p * scale + motion);
        
        // Create glowing bands based on the noise value
        float band = smoothstep(0.4, 0.6, n) * smoothstep(0.7, 0.5, n);
        
        // Assign vibrant colors to different layers
        vec3 layer_color = mix(vec3(0.1, 0.0, 0.2), vec3(0.0, 0.8, 0.9), float(i)/4.0);
        layer_color = mix(layer_color, vec3(0.9, 0.1, 0.5), sin(time * 0.3 + float(i)) * 0.5 + 0.5);
        
        color += layer_color * band * (1.0 / float(i));
        intensity += band;
    }
    
    // Add a subtle glow based on the overall intensity
    float glow = exp(-length(p) * 0.5) * intensity;
    return color + (glow * 0.2);
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    float time = iTime * 0.3;

    // Base dark background
    vec3 final_col = vec3(0.01, 0.01, 0.02);

    // Add the aurora ribbons
    vec3 aurora = aurora_ribbons(uv, time);
    final_col += aurora;

    // Subtle vignette to focus on the center
    float vignette = smoothstep(1.5, 0.5, length(uv * 2.0 - 1.0));
    final_col *= vignette;

    // Final touch: a tiny bit of digital grain for texture
    float grain = (noise(uv + time) - 0.5) * 0.03;
    final_col += grain;

    fragColor = vec4(final_col, 1.0);
}
