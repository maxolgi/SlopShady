// Name: Psychedelic Geometric Flow - Trippy Pattern Shader
// Psychedelic Geometric Flow - Trippy Pattern Shader
// (Flowing geometric patterns with intense color shifts)
vec3 palette(float t, float i) {
    // Psychedelic rainbow gradient
    vec3 a = vec3(0.0, 0.1, 0.5);      // Deep navy base
    vec3 b = vec3(1.0, 0.9, 0.3);      // Bright yellow highlight
    vec3 c = vec3(0.6, 0.2, 1.0);      // Magenta accent
    vec3 d = vec3(0.1, 0.05, 0.4);    // Dark indigo shadow
    return a + b * cos(6.28318 * (c * t + d)) + c * sin(6.28318 * (t + i));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    
    float t = iTime * 0.25; // Medium-fast flow
    
    vec3 col = vec3(0.0);
    
    // Layer 1: Primary geometric waves with sharp contrast
    vec2 p = uv;
    float angle1 = atan(p.y, p.x) + t * 0.8;
    float radius1 = length(p);
    float layer1 = abs(sin(radius1 * 3.5 - angle1 * 6.0 + t));
    
    // Layer 2: Inverted geometric pattern
    vec2 q = uv;
    float angle2 = atan(q.y, q.x) + t * 0.6;
    float radius2 = length(q);
    float layer2 = abs(cos(radius2 * 2.8 - angle2 * 5.0));
    
    // Layer 3: Concentric geometric rings
    vec2 r = uv;
    float angle3 = atan(r.y, r.x) + t * 0.4;
    float radius3 = length(r);
    float layer3 = abs(sin(radius3 * 1.8 - angle3 * 8.0 + t * 0.5));
    
    // Layer 4: Sharp angular distortion
    vec2 s = uv;
    float angle4 = atan(s.y, s.x) + t * 0.9;
    float radius4 = length(s);
    float layer4 = abs(cos(radius4 * 2.5 - angle4 * 3.5));
    
    // Layer 5: Radial symmetry with high frequency
    vec2 core = uv;
    float angle5 = atan(core.y, core.x) + t * 0.7;
    float radius5 = length(core);
    float layer5 = abs(sin(radius5 * 4.2 - angle5 * 2.3 + t * 0.3));
    
    // Combine layers with weighted geometric influence
    float combined = (layer1 * 0.2 + layer2 * 0.2 + layer3 * 0.2 + layer4 * 0.2 + layer5 * 0.2) * 0.6;
    
    // Map to psychedelic palette
    col = palette(combined * 0.5 + t, length(uv));
    
    // Add sharp geometric contrast
    float contrast = smoothstep(0.8, 1.2, radius4);
    col += vec3(0.9, 0.8, 0.6) * contrast;
    
    // Intense edge glow
    float edgeGlow = smoothstep(1.5, 2.2, radius5);
    col += vec3(1.0, 0.9, 0.7) * edgeGlow * 0.2;
    
    // Vignette with sharp falloff
    col *= (1.0 - smoothstep(1.3, 1.8, radius3));
    
    fragColor = vec4(col, 1.0);
}