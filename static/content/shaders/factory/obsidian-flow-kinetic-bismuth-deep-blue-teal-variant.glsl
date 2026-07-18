// Name: Obsidian Flow / Kinetic Bismuth (Deep Blue & Teal Variant)
// Obsidian Flow / Kinetic Bismuth (Deep Blue & Teal Variant)
// (Inspired by recursive domain warping and non-Euclidean fluid dynamics)
vec3 palette(float t) {
    // Shifted palette: Deep Navy base transitioning to bright Cyan/Teal highlights
    vec3 a = vec3(0.1, 0.05, 0.2);        // Dark deep blue base
    vec3 b = vec3(0.9, 0.95, 1.0);        // Bright cyan/teal highlight
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.26, 0.41, 0.55);
    return a + b * cos(6.28318 * (c * t + d));
}

void main() {
    // Centered UV coordinates
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    
    float t = iTime * 0.15; // Slower movement for smoother, longer trails
    
    // Domain Warping: The "Liquid Crystal" effect
    // Increased frequency and amplitude to create tighter, thinner curves
    vec2 p = uv;
    for (float i = 1.0; i < 4.0; i++) {
        p.x += 0.5 / i * sin(i * 4.0 * p.y + t); // Increased multiplier and amplitude
        p.y += 0.5 / i * cos(i * 4.0 * p.x + t);
    }
    
    // Fractal Brownian Motion-esque layering
    float strength = 8.0;
    float d = 0.0;
    vec2 grid = p * strength;
    
    // Create sharp, angular "Bismuth" steps
    for (float j = 0.0; j < 3.0; j++) {
        grid = abs(grid) / dot(grid, grid) - 0.7;
        d += length(grid) * 0.15;
    }
    
    // The "Pulse": Lighting that reacts to the distortion
    // Adjusted frequency (20.0 instead of 10.0) to emphasize high-frequency details 
    // which creates crisp, thin glowing lines rather than thick blobs
    float wave = sin(d * 20.0 - t * 3.0); 
    float glow = smoothstep(0.1, 0.0, abs(wave));
    
    // Coloring based on the warped coordinates + the fractal distance
    vec3 col = palette(length(p) * 0.5 + d * 0.2);
    
    // Injecting the "Metallic" sheen (now Cyan/Teal sheen)
    // Increased multiplier (1.2 instead of 0.8) to boost intensity and brightness
    col += (glow * 1.2) * vec3(0.8, 0.9, 1.0); 
    
    col *= 1.1 - length(uv); // Soft natural vignette
    
    // Final punch: High-pass style contrast to make lines pop against the dark background
    col = mix(col, col * col, 0.6); 
    
    fragColor = vec4(col, 1.0);
}