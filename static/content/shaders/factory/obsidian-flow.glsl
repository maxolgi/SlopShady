// Name: Obsidian Flow / Kinetic Bismuth
// Obsidian Flow / Kinetic Bismuth
// (Inspired by recursive domain warping and non-Euclidean fluid dynamics)
vec3 palette(float t) {
    // A more "iridescent metal" palette: deep purples, golds, and neon cyans
    vec3 a = vec3(0.2, 0.1, 0.3);
    vec3 b = vec3(0.5, 0.4, 0.2);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.26, 0.41, 0.55);
    return a + b * cos(6.28318 * (c * t + d));
}
void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime * 0.25;
    
    // Domain Warping: The "Liquid Crystal" effect
    vec2 p = uv;
    for (float i = 1.0; i < 4.0; i++) {
        p.x += 0.3 / i * sin(i * 3.0 * p.y + t);
        p.y += 0.3 / i * cos(i * 3.0 * p.x + t);
    }
    
    // Fractal Brownian Motion-esque layering
    float strength = 7.0;
    float d = 0.0;
    vec2 grid = p * strength;
    
    // Create sharp, angular "Bismuth" steps
    for (float j = 0.0; j < 3.0; j++) {
        grid = abs(grid) / dot(grid, grid) - 0.7;
        d += length(grid) * 0.15;
    }
    
    // The "Pulse": Lighting that reacts to the distortion
    float wave = sin(d * 10.0 - t * 2.0);
    float glow = smoothstep(0.1, 0.0, abs(wave));
    
    // Coloring based on the warped coordinates + the fractal distance
    vec3 col = palette(length(p) * 0.5 + d * 0.2);
    
    // Injecting the "Metallic" sheen
    col += (glow * 0.8) * vec3(0.8, 0.9, 1.0);
    col *= 1.2 - length(uv); // Soft natural vignette
    
    // Final punch: High-pass style contrast
    col = mix(col, col * col, 0.5);
    
    fragColor = vec4(col, 1.0);
}