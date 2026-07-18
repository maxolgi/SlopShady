// Name: Obsidian Flow / Kinetic Bismuth (Rich Gradient Liquid Variant)
// Obsidian Flow / Kinetic Bismuth (Rich Gradient Liquid Variant)
// (Smooth organic gradients with rich color blending)
vec3 palette(float t) {
    // Richer, warmer palette mixing orange, blue, and yellow tones
    vec3 a = vec3(0.5, 0.1, 0.0);        // Deep red/orange base
    vec3 b = vec3(0.2, 0.6, 1.0);        // Bright cyan/blue highlight
    vec3 c = vec3(1.0, 0.9, 0.5);        // Yellow/cream accent
    vec3 d = vec3(0.4, 0.3, 0.2);        // Dark warm grey
    return a + b * cos(6.28318 * (c * t + d)) + c * sin(6.28318 * (t));
}

void main() {
    // Centered UV coordinates
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    
    float t = iTime * 0.4; // Moderate speed for fluid feel
    
    // Smooth Domain Warping: Rotating and distorting the grid
    vec2 p = uv;
    
    // Create organic flow by rotating UVs based on distance
    float angle = length(uv) * 0.5 + t * 0.3; 
    mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
    vec2 rotatedUV = rot * uv;
    
    // Add distortion layers for "liquid" feel
    float amp = 2.0;
    float freq = 1.5;
    
    // Create a gradient of noise based on the warped coordinates
    float noiseVal = sin(rotatedUV.x * freq) * cos(rotatedUV.y * freq);
    noiseVal += sin(length(uv) * 3.0 + t) * 0.5;
    
    // Map noise to color palette
    vec3 col = palette(noiseVal * 2.0 + t);
    
    // Add a secondary deep blue overlay for contrast
    float darkOverlay = smoothstep(0.8, 1.0, length(uv));
    col += vec3(0.05) * darkOverlay; 
    
    // Soft vignette to blend edges naturally
    col *= (1.0 - smoothstep(1.2, 1.5, length(uv)));
    
    fragColor = vec4(col, 1.0);
}