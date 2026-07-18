// Name: Cosmic Nebula / Starfield
// Cosmic Nebula / Starfield
// (A shift from metallic sharpness to soft, ethereal glows and distant stars)
vec3 palette(float t) {
    // Deep cosmic colors: dark blues, purples, and bright cyan highlights
    vec3 a = vec3(0.0, 0.0, 0.1);
    vec3 b = vec3(0.5, 0.2, 0.8);
    vec3 c = vec3(0.1, 0.9, 1.0);
    vec3 d = vec3(0.0, 0.1, 0.2);
    return a + b * cos(6.28318 * (c * t + d));
}

// Simple hash function for star generation
float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime * 0.1; // Slower, more drifting motion
    
    // --- Part 1: The Nebula (Soft, flowing clouds) ---
    vec2 p = uv;
    float nebula_strength = 0.0;
    for (float i = 1.0; i < 4.0; i++) {
        p += vec2(0.5 / i * sin(i * 2.0 * p.y + t), 0.5 / i * cos(i * 2.0 * p.x + t));
        nebula_strength += length(p) * (1.0 / i);
    }
    
    vec3 nebula_col = palette(nebula_strength * 0.3 + t * 0.2);
    
    // --- Part 2: The Starfield (Tiny, flickering points) ---
    float star_layer = 0.0;
    // We use a grid-based approach to place stars without massive loops
    vec2 star_uv = uv * 50.0; // Scale for density
    vec2 cell = floor(star_uv);
    vec2 f = fract(star_uv) - 0.5;
    
    // Randomness per cell
    float h = hash(cell);
    if (h > 0.98) { // Only some cells have stars
        float star_size = hash(cell + 1.0) * 0.1;
        float dist = length(f - (vec2(hash(cell + 2.0), hash(cell + 3.0)) - 0.5));
        star_layer = smoothstep(star_size, 0.0, dist);
        // Add a little twinkle
        star_layer *= 0.5 + 0.5 * sin(iTime * 3.0 + h * 10.0);
    }
    
    // --- Final Composition ---
    vec3 col = nebula_col;
    col += star_layer * vec3(1.0, 1.0, 1.0); // Add bright stars
    
    // Darken the edges/background for depth
    col *= 1.2 - length(uv) * 0.8;
    
    // Subtle vignette and contrast
    col = mix(col, col * col, 0.3);
    
    fragColor = vec4(col, 1.0);
}
