// Name: Flowing Sand Dunes - Desert Gradient Shader
// Flowing Sand Dunes - Desert Gradient Shader
// (Warm earth tones with flowing dune patterns)
vec3 palette(float t, float i) {
    // Warm desert gradient mixing amber, gold, and deep brown
    vec3 a = vec3(0.25, 0.18, 0.05);   // Deep sand base
    vec3 b = vec3(0.85, 0.65, 0.35);   // Golden amber highlight
    vec3 c = vec3(0.65, 0.45, 0.25);   // Terracotta accent
    vec3 d = vec3(0.12, 0.08, 0.03);   // Dark earth shadow
    return a + b * cos(6.28318 * (c * t + d)) + c * sin(6.28318 * (t + i));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    
    float t = iTime * 0.28; // Slow dune movement
    
    vec3 col = vec3(0.0);
    
    // Layer 1: Primary dune flow with sweeping motion
    vec2 p = uv;
    float angle1 = atan(p.y, p.x) + t * 0.72;
    float radius1 = length(p);
    float layer1 = sin(radius1 * 2.6 - angle1 * 4.8 + t) * 0.68;
    
    // Layer 2: Secondary dune ridge with counter-flow
    vec2 q = uv;
    float angle2 = atan(q.y, q.x) + t * 0.58;
    float radius2 = length(q);
    float layer2 = cos(radius2 * 1.9 - angle2 * 3.6 + t * 0.42) * 0.64;
    
    // Layer 3: Tertiary dune valley with soft transitions
    vec2 r = uv;
    float angle3 = atan(r.y, r.x) + t * 0.48;
    float radius3 = length(r);
    float layer3 = sin(radius3 * 1.4 - angle3 * 5.8 + t * 0.62) * 0.58;
    
    // Layer 4: Quaternary dune ripple with high frequency
    vec2 s = uv;
    float angle4 = atan(s.y, s.x) + t * 0.88;
    float radius4 = length(s);
    float layer4 = abs(cos(radius4 * 3.4 - angle4 * 2.6 + t)) * 0.54;
    
    // Layer 5: Pentagonal dune core with radial intensity
    vec2 core = uv;
    float angle5 = atan(core.y, core.x) + t * 0.92;
    float radius5 = length(core);
    float layer5 = abs(sin(radius5 * 4.6 - angle5 * 1.8 + t)) * 0.62;
    
    // Layer 6: Outer dune horizon with atmospheric fade
    vec2 horizon = uv;
    float angle6 = atan(horizon.y, horizon.x) + t * 0.82;
    float radius6 = length(horizon);
    float layer6 = sin(radius6 * 3.1 - angle6 * 3.4 + t * 0.75) * 0.52;
    
    // Combine dune layers with weighted influence
    float combined = layer1 * 0.18 + layer2 * 0.17 + layer3 * 0.16 + 
                     layer4 * 0.16 + layer5 * 0.17 + layer6 * 0.16;
    
    // Map to desert gradient palette
    col = palette(combined * 0.45 + t, length(uv));
    
    // Add warm sunset glow at edges
    float sunsetGlow = smoothstep(1.3, 1.8, radius6);
    col += vec3(0.95, 0.75, 0.45) * sunsetGlow * 0.18;
    
    // Sand particle trail effect
    float sandTrails = sin(radius4 * 4.2 + t * 0.28) * 0.06;
    col += vec3(0.8, 0.65, 0.35) * sandTrails;
    
    // Atmospheric haze for desert feel
    float desertHaze = smoothstep(1.4, 2.2, radius5);
    col += vec3(0.7, 0.55, 0.3) * desertHaze * 0.15;
    
    fragColor = vec4(col, 1.0);
}