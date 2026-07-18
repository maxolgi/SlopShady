// Name: Cosmic Flow Burst - Dynamic Gradient Explosion Shader
// Cosmic Flow Burst - Dynamic Gradient Explosion Shader
// (Explosive flowing gradients with high contrast)
vec3 palette(float t, float i) {
    // Explosive gradient mixing deep purple, electric blue, and bright magenta
    vec3 a = vec3(0.18, 0.06, 0.45);   // Deep cosmic purple base
    vec3 b = vec3(0.95, 0.75, 0.88);   // Electric magenta highlight
    vec3 c = vec3(0.7, 0.45, 0.95);   // Violet accent
    vec3 d = vec3(0.06, 0.12, 0.3);    // Deep indigo shadow
    return a + b * cos(6.28318 * (c * t + d)) + c * sin(6.28318 * (t + i));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    
    float t = iTime * 0.18; // Dynamic burst motion
    
    vec3 col = vec3(0.0);
    
    // Layer 1: Primary radial burst with explosive flow
    vec2 p = uv;
    float angle1 = atan(p.y, p.x) + t * 0.75;
    float radius1 = length(p);
    float layer1 = sin(radius1 * 3.2 - angle1 * 5.8 + t) * 0.72;
    
    // Layer 2: Secondary burst with counter-rotation
    vec2 q = uv;
    float angle2 = atan(q.y, q.x) + t * 0.6;
    float radius2 = length(q);
    float layer2 = cos(radius2 * 2.4 - angle2 * 4.5 + t * 0.38) * 0.68;
    
    // Layer 3: Concentric explosion rings
    vec2 r = uv;
    float angle3 = atan(r.y, r.x) + t * 0.5;
    float radius3 = length(r);
    float layer3 = sin(radius3 * 1.8 - angle3 * 7.2 + t * 0.65) * 0.62;
    
    // Layer 4: High-frequency detail burst
    vec2 s = uv;
    float angle4 = atan(s.y, s.x) + t * 0.9;
    float radius4 = length(s);
    float layer4 = abs(cos(radius4 * 3.6 - angle4 * 2.2 + t)) * 0.58;
    
    // Layer 5: Central explosion core
    vec2 core = uv;
    float angle5 = atan(core.y, core.x) + t * 0.95;
    float radius5 = length(core);
    float layer5 = abs(sin(radius5 * 4.8 - angle5 * 1.4 + t)) * 0.65;
    
    // Layer 6: Outer halo with soft diffusion
    vec2 halo = uv;
    float angle6 = atan(halo.y, halo.x) + t * 0.85;
    float radius6 = length(halo);
    float layer6 = sin(radius6 * 2.9 - angle6 * 3.1 + t * 0.7) * 0.55;
    
    // Combine burst layers with weighted influence
    float combined = layer1 * 0.18 + layer2 * 0.18 + layer3 * 0.18 + 
                     layer4 * 0.16 + layer5 * 0.17 + layer6 * 0.13;
    
    // Map to cosmic explosion palette
    col = palette(combined * 0.48 + t, length(uv));
    
    // Add intense central explosion glow
    float explosionGlow = smoothstep(0.75, 1.4, radius6);
    col += vec3(1.0, 0.95, 0.92) * explosionGlow * 0.22;
    
    // Burst particle trail effect
    float burstTrails = sin(radius4 * 4.8 + t * 0.22) * 0.07;
    col += vec3(0.85, 0.75, 0.95) * burstTrails;
    
    // Deep space vignette for atmosphere
    col *= (1.0 - smoothstep(1.45, 2.1, radius5));
    
    fragColor = vec4(col, 1.0);
}