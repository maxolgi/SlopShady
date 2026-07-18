// Name: Cosmic Nebula Flow - Deep Space Gradient Shader
// Cosmic Nebula Flow - Deep Space Gradient Shader
// (Flowing star-gas mix with deep space colors)
vec3 palette(float t, float i) {
    // Deep cosmic gradient mixing purple, blue, magenta, and gold tones
    vec3 a = vec3(0.1, 0.05, 0.2);      // Deep midnight base
    vec3 b = vec3(0.9, 0.4, 1.0);       // Electric violet highlight
    vec3 c = vec3(1.0, 0.8, 0.3);       // Golden nebula core
    vec3 d = vec3(0.2, 0.1, 0.3);       // Dark cosmic dust
    return a + b * cos(6.28318 * (c * t + d)) + c * sin(6.28318 * (t + i));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    
    float t = iTime * 0.2; // Slow, cosmic drift
    
    // Multi-layer domain warping for nebula effect
    vec3 col = vec3(0.0);
    
    // Layer 1: Swirling galaxy arms
    float angle1 = atan(uv.y, uv.x) + t * 0.5;
    float radius1 = length(uv);
    float layer1 = sin(radius1 * 2.0 - angle1 * 3.0 + t);
    
    // Layer 2: Spiral arms with varying frequency
    float angle2 = atan(uv.y, uv.x) + t * 0.3;
    float radius2 = length(uv);
    float layer2 = cos(radius2 * 1.5 - angle2 * 4.0);
    
    // Layer 3: Nebula clouds with smooth transitions
    float angle3 = atan(uv.y, uv.x) + t * 0.2;
    float radius3 = length(uv);
    float layer3 = sin(radius3 * 0.8 - angle3 * 6.0 + t * 0.5);
    
    // Layer 4: Star field depth variation
    float angle4 = atan(uv.y, uv.x) + t * 0.1;
    float radius4 = length(uv);
    float layer4 = cos(radius4 * 3.5 - angle4 * 2.5);
    
    // Combine layers with weighted influence
    float combined = layer1 * 0.3 + layer2 * 0.25 + layer3 * 0.25 + layer4 * 0.2;
    
    // Map to cosmic palette
    col = palette(combined * 0.5 + t, length(uv));
    
    // Add star-like highlights at the core
    float glow = smoothstep(0.6, 0.9, radius4);
    col += vec3(1.0, 0.8, 0.5) * glow * 0.3;
    
    // Deep space vignette
    col *= (1.0 - smoothstep(1.5, 2.0, length(uv)));
    
    // Add cosmic dust overlay for depth
    float dust = sin(length(uv) * 4.0 + t) * 0.05;
    col += vec3(0.1, 0.08, 0.15) * dust;
    
    fragColor = vec4(col, 1.0);
}