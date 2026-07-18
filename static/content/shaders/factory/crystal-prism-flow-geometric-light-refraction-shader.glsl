// Name: Crystal Prism Flow - Geometric Light Refraction Shader
// Crystal Prism Flow - Geometric Light Refraction Shader
// (Diamond-like faceted patterns with rainbow dispersion)
vec3 palette(float t, float i) {
    // Rainbow crystal gradient with prismatic colors
    vec3 a = vec3(0.15, 0.6, 0.8);     // Deep teal base
    vec3 b = vec3(0.9, 0.2, 0.4);      // Magenta highlight
    vec3 c = vec3(0.6, 0.7, 1.0);     // Cyan accent
    vec3 d = vec3(0.05, 0.3, 0.5);    // Indigo shadow
    return a + b * cos(6.28318 * (c * t + d)) + c * sin(6.28318 * (t + i));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    
    float t = iTime * 0.25; // Medium-fast flow
    
    vec3 col = vec3(0.0);
    
    // Layer 1: Primary prismatic facet with sharp edges
    vec2 p = uv;
    float angle1 = atan(p.y, p.x) + t * 0.8;
    float radius1 = length(p);
    float layer1 = abs(sin(radius1 * 4.5 - angle1 * 6.2 + t)) * 0.75;
    
    // Layer 2: Secondary crystal facet with high frequency
    vec2 q = uv;
    float angle2 = atan(q.y, q.x) + t * 0.65;
    float radius2 = length(q);
    float layer2 = abs(cos(radius2 * 3.8 - angle2 * 5.5 + t * 0.4)) * 0.7;
    
    // Layer 3: Tertiary crystal ring with dispersion
    vec2 r = uv;
    float angle3 = atan(r.y, r.x) + t * 0.55;
    float radius3 = length(r);
    float layer3 = abs(sin(radius3 * 2.8 - angle3 * 7.8 + t * 0.6)) * 0.65;
    
    // Layer 4: Quaternary facet with angular distortion
    vec2 s = uv;
    float angle4 = atan(s.y, s.x) + t * 0.9;
    float radius4 = length(s);
    float layer4 = abs(cos(radius4 * 5.2 - angle4 * 3.8 + t)) * 0.6;
    
    // Layer 5: Pentagonal crystal core with radial burst
    vec2 core = uv;
    float angle5 = atan(core.y, core.x) + t * 0.95;
    float radius5 = length(core);
    float layer5 = abs(sin(radius5 * 6.8 - angle5 * 2.1 + t)) * 0.7;
    
    // Layer 6: Outer crystal halo with soft edges
    vec2 halo = uv;
    float angle6 = atan(halo.y, halo.x) + t * 0.85;
    float radius6 = length(halo);
    float layer6 = abs(sin(radius6 * 3.5 - angle6 * 4.8 + t * 0.7)) * 0.55;
    
    // Combine crystal layers with weighted influence
    float combined = layer1 * 0.17 + layer2 * 0.17 + layer3 * 0.17 + 
                     layer4 * 0.16 + layer5 * 0.18 + layer6 * 0.15;
    
    // Map to prismatic crystal palette
    col = palette(combined * 0.5 + t, length(uv));
    
    // Add central crystal core glow
    float crystalGlow = smoothstep(0.7, 1.3, radius6);
    col += vec3(1.0, 0.95, 0.9) * crystalGlow * 0.2;
    
    // Crystal edge shimmer effect
    float crystalShimmer = sin(radius4 * 5.8 + t * 0.25) * 0.06;
    col += vec3(0.9, 0.85, 1.0) * crystalShimmer;
    
    // Deep space vignette for atmosphere
    col *= (1.0 - smoothstep(1.45, 2.0, radius5));
    
    fragColor = vec4(col, 1.0);
}