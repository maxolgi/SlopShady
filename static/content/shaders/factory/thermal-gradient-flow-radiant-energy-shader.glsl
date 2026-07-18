// Name: Thermal Gradient Flow - Radiant Energy Shader
// Thermal Gradient Flow - Radiant Energy Shader
// (Warm organic gradients with flowing heat signatures)
vec3 palette(float t, float i) {
    // Warm thermal gradient mixing deep reds, oranges, and golden highlights
    vec3 a = vec3(0.15, 0.08, 0.05);   // Deep ember base
    vec3 b = vec3(0.95, 0.85, 0.35);   // Golden fire highlight
    vec3 c = vec3(0.6, 0.4, 0.2);      // Burnt orange midtone
    vec3 d = vec3(0.1, 0.05, 0.02);    // Dark shadow
    return a + b * cos(6.28318 * (c * t + d)) + c * sin(6.28318 * (t + i));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    
    float t = iTime * 0.12; // Slow thermal drift
    
    vec3 col = vec3(0.0);
    
    // Layer 1: Primary radial flow with heat distortion
    vec2 p = uv;
    float angle1 = atan(p.y, p.x) + t * 0.7;
    float radius1 = length(p);
    float layer1 = sin(radius1 * 2.3 - angle1 * 5.0 + t);
    
    // Layer 2: Secondary heat waves with counter-flow
    vec2 q = uv;
    float angle2 = atan(q.y, q.x) + t * 0.5;
    float radius2 = length(q);
    float layer2 = cos(radius2 * 1.7 - angle2 * 3.8 + t * 0.5);
    
    // Layer 3: Concentric thermal rings
    vec2 r = uv;
    float angle3 = atan(r.y, r.x) + t * 0.3;
    float radius3 = length(r);
    float layer3 = sin(radius3 * 1.1 - angle3 * 7.5 + t * 0.4);
    
    // Layer 4: Heat haze distortion
    vec2 s = uv;
    float angle4 = atan(s.y, s.x) + t * 0.6;
    float radius4 = length(s);
    float layer4 = cos(radius4 * 3.0 - angle4 * 2.2 + t * 0.6);
    
    // Layer 5: Core heat intensity
    vec2 core = uv;
    float angle5 = atan(core.y, core.x) + t * 0.8;
    float radius5 = length(core);
    float layer5 = sin(radius5 * 4.5 - angle5 * 1.8 + t * 0.3);
    
    // Combine layers with weighted thermal influence
    float combined = layer1 * 0.20 + layer2 * 0.20 + layer3 * 0.20 + layer4 * 0.15 + layer5 * 0.25;
    
    // Map to thermal palette
    col = palette(combined * 0.35 + t, length(uv));
    
    // Add core heat glow at center
    float coreGlow = smoothstep(0.9, 1.4, radius4);
    col += vec3(1.0, 0.9, 0.6) * coreGlow * 0.25;
    
    // Heat haze overlay for atmosphere
    float haze = sin(radius3 * 2.5 + t * 0.2) * 0.08;
    col += vec3(0.15, 0.1, 0.05) * haze;
    
    // Edge vignette for depth
    col *= (1.0 - smoothstep(1.4, 1.9, radius5));
    
    fragColor = vec4(col, 1.0);
}