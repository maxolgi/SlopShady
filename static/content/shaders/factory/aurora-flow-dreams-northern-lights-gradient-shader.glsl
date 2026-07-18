// Name: Aurora Flow Dreams - Northern Lights Gradient Shader
// Aurora Flow Dreams - Northern Lights Gradient Shader
// (Ethereal flowing aurora with deep space colors)
vec3 palette(float t, float i) {
    // Ethereal aurora gradient mixing teal, emerald, and violet
    vec3 a = vec3(0.12, 0.65, 0.85);   // Deep midnight teal base
    vec3 b = vec3(0.75, 0.9, 0.95);    // Bright aquamarine highlight
    vec3 c = vec3(0.45, 0.6, 0.8);     // Soft lavender accent
    vec3 d = vec3(0.05, 0.25, 0.5);    // Deep indigo shadow
    return a + b * cos(6.28318 * (c * t + d)) + c * sin(6.28318 * (t + i));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    
    float t = iTime * 0.22; // Gentle aurora drift
    
    vec3 col = vec3(0.0);
    
    // Layer 1: Primary aurora wave with flowing motion
    vec2 p = uv;
    float angle1 = atan(p.y, p.x) + t * 0.78;
    float radius1 = length(p);
    float layer1 = sin(radius1 * 2.4 - angle1 * 4.6 + t) * 0.7;
    
    // Layer 2: Secondary aurora with counter-flow
    vec2 q = uv;
    float angle2 = atan(q.y, q.x) + t * 0.62;
    float radius2 = length(q);
    float layer2 = cos(radius2 * 1.7 - angle2 * 3.8 + t * 0.4) * 0.65;
    
    // Layer 3: Tertiary aurora curtain with soft edges
    vec2 r = uv;
    float angle3 = atan(r.y, r.x) + t * 0.52;
    float radius3 = length(r);
    float layer3 = sin(radius3 * 1.3 - angle3 * 5.6 + t * 0.65) * 0.6;
    
    // Layer 4: Quaternary aurora ripple with detail
    vec2 s = uv;
    float angle4 = atan(s.y, s.x) + t * 0.92;
    float radius4 = length(s);
    float layer4 = abs(cos(radius4 * 3.6 - angle4 * 2.4 + t)) * 0.55;
    
    // Layer 5: Pentagonal aurora core with radial flow
    vec2 core = uv;
    float angle5 = atan(core.y, core.x) + t * 0.96;
    float radius5 = length(core);
    float layer5 = abs(sin(radius5 * 4.8 - angle5 * 1.6 + t)) * 0.63;
    
    // Layer 6: Outer aurora halo with atmospheric diffusion
    vec2 halo = uv;
    float angle6 = atan(halo.y, halo.x) + t * 0.86;
    float radius6 = length(halo);
    float layer6 = sin(radius6 * 3.3 - angle6 * 3.2 + t * 0.72) * 0.53;
    
    // Combine aurora layers with weighted influence
    float combined = layer1 * 0.18 + layer2 * 0.17 + layer3 * 0.16 + 
                     layer4 * 0.16 + layer5 * 0.18 + layer6 * 0.15;
    
    // Map to aurora palette
    col = palette(combined * 0.47 + t, length(uv));
    
    // Add northern lights core glow
    float auroraGlow = smoothstep(0.68, 1.35, radius6);
    col += vec3(0.92, 0.95, 0.98) * auroraGlow * 0.2;
    
    // Aurora particle trail effect
    float auroraTrails = sin(radius4 * 4.6 + t * 0.26) * 0.07;
    col += vec3(0.6, 0.85, 1.0) * auroraTrails;
    
    // Deep space atmospheric haze
    float spaceHaze = smoothstep(1.42, 2.15, radius5);
    col += vec3(0.15, 0.28, 0.45) * spaceHaze * 0.16;
    
    fragColor = vec4(col, 1.0);
}