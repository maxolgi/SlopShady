// Name: Obsidian Flow / Kinetic Bismuth - Enhanced Vibrant Version
// Obsidian Flow / Kinetic Bismuth - Enhanced Vibrant Version
// (Inspired by recursive domain warping and non-Euclidean fluid dynamics)
vec3 palette(float t) {
    // A more vibrant "iridescent metal" palette: deep purples, golds, neon cyans with higher saturation
    vec3 a = vec3(0.1, 0.05, 0.25);
    vec3 b = vec3(0.6, 0.45, 0.25);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.3, 0.45, 0.6);
    return a + b * cos(6.28318 * (c * t + d));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime * 0.35; // Faster time for more dynamic movement
    
    // Domain Warping: Enhanced "Liquid Crystal" effect with more intensity
    vec2 p = uv;
    for (float i = 1.0; i < 4.0; i++) {
        p.x += 0.4 / i * sin(i * 3.5 * p.y + t);
        p.y += 0.4 / i * cos(i * 3.5 * p.x + t);
    }
    
    // Fractal Brownian Motion-esque layering with more depth
    float strength = 8.5;
    float d = 0.0;
    vec2 grid = p * strength;
    
    // Create sharp, angular "Bismuth" steps with enhanced contrast
    for (float j = 0.0; j < 3.0; j++) {
        grid = abs(grid) / dot(grid, grid) - 0.7;
        d += length(grid) * 0.18; // Increased contribution
    }
    
    // The "Pulse": Enhanced lighting that reacts to distortion with more drama
    float wave = sin(d * 12.0 - t * 3.0); // Faster and more dramatic
    float glow = smoothstep(0.05, 0.0, abs(wave)); // Sharper transitions
    
    // Additional dynamic layering for more movement
    float flow = sin(p.x * 5.0 + p.y * 3.0 - t * 2.0);
    float pulse = cos(t * 1.5) * 0.3;
    
    // Coloring based on warped coordinates + fractal distance + dynamic flow
    vec3 col = palette(length(p) * 0.6 + d * 0.3 + t * 0.2);
    
    // Enhanced "Metallic" sheen with more intensity
    col += (glow * 1.2) * vec3(0.9, 1.0, 1.1); // Increased brightness
    
    // Dynamic vignette with flow effects
    float vignette = 1.2 - length(uv) + flow * 0.1;
    col *= max(0.8, vignette);
    
    // Final punch: Enhanced high-pass style contrast for more vibrancy
    col = mix(col, col * vec3(1.3, 1.4, 1.5), 0.6); // Color channel boost
    
    // Additional saturation boost
    float saturation = 1.3 + abs(sin(t * 2.0)) * 0.2;
    col = (col - vec3(0.5)) * saturation + vec3(0.5);
    
    fragColor = vec4(col, 1.0);
}