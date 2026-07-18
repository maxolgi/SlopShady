// Name: Liquid Metal Flow - Trippy Fluid Shader
// Liquid Metal Flow - Trippy Fluid Shader
// (Organic flowing patterns with metallic color gradients)
vec3 palette(float t, float i) {
    // Metallic rainbow gradient
    vec3 a = vec3(0.1, 0.05, 0.2);      // Deep space blue base
    vec3 b = vec3(0.8, 0.9, 1.0);       // Bright silver highlight
    vec3 c = vec3(0.2, 0.6, 0.8);       // Aqua shimmer
    vec3 d = vec3(0.05, 0.2, 0.4);      // Deep indigo shadow
    return a + b * cos(6.28318 * (c * t + d)) + c * sin(6.28318 * (t + i));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    
    float t = iTime * 0.15; // Slow, liquid-like flow
    
    // Create flowing domain warping with multiple layers
    vec3 col = vec3(0.0);
    
    // Layer 1: Primary wave distortion
    vec2 p = uv;
    float angle1 = atan(p.y, p.x) + t * 0.6;
    float radius1 = length(p);
    float layer1 = sin(radius1 * 1.8 - angle1 * 4.5 + t);
    
    // Layer 2: Secondary wave with opposite frequency
    vec2 q = uv;
    float angle2 = atan(q.y, q.x) + t * 0.4;
    float radius2 = length(q);
    float layer2 = cos(radius2 * 2.5 - angle2 * 3.0);
    
    // Layer 3: Radial symmetry with noise
    vec2 r = uv;
    float angle3 = atan(r.y, r.x) + t * 0.2;
    float radius3 = length(r);
    float layer3 = sin(radius3 * 0.7 - angle3 * 6.0 + t * 0.8);
    
    // Layer 4: Concentric rings with varying contrast
    vec2 s = uv;
    float angle4 = atan(s.y, s.x) + t * 0.5;
    float radius4 = length(s);
    float layer4 = cos(radius4 * 1.2 - angle4 * 2.8 + t * 0.3);
    
    // Combine layers with weighted influence
    float combined = layer1 * 0.25 + layer2 * 0.25 + layer3 * 0.25 + layer4 * 0.25;
    
    // Map to metallic palette
    col = palette(combined * 0.4 + t, length(uv));
    
    // Add vignette for depth
    float vignette = smoothstep(1.2, 1.8, length(uv));
    col *= (1.0 - vignette);
    
    // Add subtle glow at edges
    float edgeGlow = smoothstep(1.5, 2.0, length(uv));
    col += vec3(0.8, 0.9, 1.0) * edgeGlow * 0.1;
    
    fragColor = vec4(col, 1.0);
}