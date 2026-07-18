// Name: Obsidian Flow / Kinetic Bismuth - MAXIMIZED VIBRANCE & DYNAMICS
// Obsidian Flow / Kinetic Bismuth - MAXIMIZED VIBRANCE & DYNAMICS
// (Recursive domain warping + multi-scale fluid dynamics)
vec3 palette(float t) {
    // Ultra-vibrant "prismatic metal" palette: neon purples, electric golds, cyan explosions
    vec3 a = vec3(0.12, 0.05, 0.25);
    vec3 b = vec3(0.85, 0.65, 0.45);  // Higher contrast values for saturation
    vec3 c = vec3(1.5, 1.5, 1.5);     // Increased multiplier for brighter colors
    vec3 d = vec3(0.28, 0.45, 0.62);
    return a + b * cos(6.28318 * (c * t + d));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime * 0.6;  // Even faster animation for hyper-dynamic feel
    
    // Domain Warping: MAXIMIZED "Liquid Crystal" chaos with extreme intensity
    vec2 p = uv;
    for (float i = 1.0; i < 6.0; i++) {  // More iterations = more complexity
        p.x += 0.5 / i * sin(i * 4.5 * p.y + t);  // Increased amplitude and frequency
        p.y += 0.5 / i * cos(i * 4.5 * p.x + t);
    }
    
    // Fractal Brownian Motion-esque layering with MAXIMIZED detail
    float strength = 12.0;  // Higher for more intricate detail
    float d = 0.0;
    vec2 grid = p * strength;
    
    // Create SHARPER, MORE ANGULAR "Bismuth" steps with stronger contributions
    for (float j = 0.0; j < 5.0; j++) {  // Two more iterations for complexity
        grid = abs(grid) / dot(grid, grid) - 0.65;
        d += length(grid) * 0.22;  // Higher contribution per layer
    }
    
    // Enhanced "Pulse": EXPLOSIVE lighting reaction to distortion
    float wave = sin(d * 15.0 - t * 4.0);  // Ultra-high frequency, explosive pulse
    float glow = smoothstep(0.03, 0.0, abs(wave));  // Sharper threshold for crisp edges
    
    // Coloring with MAXIMIZED palette sampling and contrast
    vec3 col = palette(length(p) * 0.75 + d * 0.35);  // More weight to d for drama
    
    // Injecting "Metallic" sheen - ULTRA-ENHANCED glow effect
    col += (glow * 2.0) * vec3(1.0, 1.15, 1.4);  // Stronger metallic boost with blue tint
    
    // Dramatic vignette with extreme falloff for focus
    col *= 1.6 - length(uv) * 2.2;  // Enhanced vignette
    
    // Final punch: EXTREME high-pass contrast + saturation explosion
    col = mix(col, col * col, 0.75);  // Maximum contrast
    col += vec3(0.2, 0.35, 0.6) * smoothstep(0.0, 0.9, length(uv));  // Color injection for vibrancy
    
    // Extra dynamic edge enhancement
    float edges = abs(d - floor(d + 0.5)) * 3.0;
    col += vec3(1.0, 0.85, 0.6) * edges * smoothstep(0.0, 0.5, length(uv));
    
    fragColor = vec4(col, 1.0);
}