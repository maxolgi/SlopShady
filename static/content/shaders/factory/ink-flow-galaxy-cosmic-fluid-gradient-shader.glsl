// Name: Ink Flow Galaxy - Cosmic Fluid Gradient Shader
// Ink Flow Galaxy - Cosmic Fluid Gradient Shader
// (Organic ink-like diffusion with galaxy spiral patterns)
vec3 palette(float t, float i) {
    // Deep cosmic ink gradient mixing violet, indigo, and magenta tones
    vec3 a = vec3(0.15, 0.08, 0.4);   // Deep midnight purple base
    vec3 b = vec3(0.9, 0.6, 0.85);    // Magenta ink highlight
    vec3 c = vec3(0.6, 0.3, 0.7);     // Lavender accent
    vec3 d = vec3(0.05, 0.1, 0.25);   // Dark indigo shadow
    return a + b * cos(6.28318 * (c * t + d)) + c * sin(6.28318 * (t + i));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    
    float t = iTime * 0.22; // Slow ink diffusion
    
    vec3 col = vec3(0.0);
    
    // Layer 1: Primary ink diffusion with spiral motion
    vec2 p = uv;
    float angle1 = atan(p.y, p.x) + t * 0.7;
    float radius1 = length(p);
    float layer1 = sin(radius1 * 2.5 - angle1 * 4.5 + t) * 0.65;
    
    // Layer 2: Secondary ink swirl with counter-rotation
    vec2 q = uv;
    float angle2 = atan(q.y, q.x) + t * 0.55;
    float radius2 = length(q);
    float layer2 = cos(radius2 * 1.8 - angle2 * 3.8 + t * 0.4) * 0.6;
    
    // Layer 3: Galactic spiral arms with varying density
    vec2 r = uv;
    float angle3 = atan(r.y, r.x) + t * 0.4;
    float radius3 = length(r);
    float layer3 = sin(radius3 * 1.5 - angle3 * 6.2 + t * 0.7) * 0.55;
    
    // Layer 4: Nebula cloud diffusion with soft edges
    vec2 s = uv;
    float angle4 = atan(s.y, s.x) + t * 0.65;
    float radius4 = length(s);
    float layer4 = cos(radius4 * 2.8 - angle4 * 2.5 + t * 0.35) * 0.5;
    
    // Layer 5: Core galaxy intensity with radial burst
    vec2 core = uv;
    float angle5 = atan(core.y, core.x) + t * 0.85;
    float radius5 = length(core);
    float layer5 = abs(sin(radius5 * 4.0 - angle5 * 1.7 + t)) * 0.5;
    
    // Layer 6: Outer halo with gentle diffusion
    vec2 halo = uv;
    float angle6 = atan(halo.y, halo.x) + t * 0.95;
    float radius6 = length(halo);
    float layer6 = sin(radius6 * 3.3 - angle6 * 2.1 + t * 0.8) * 0.45;
    
    // Combine ink layers with weighted diffusion influence
    float combined = layer1 * 0.17 + layer2 * 0.17 + layer3 * 0.18 + 
                     layer4 * 0.16 + layer5 * 0.16 + layer6 * 0.16;
    
    // Map to cosmic ink palette
    col = palette(combined * 0.42 + t, length(uv));
    
    // Add central galaxy glow
    float galaxyGlow = smoothstep(0.8, 1.5, radius6);
    col += vec3(1.0, 0.95, 0.9) * galaxyGlow * 0.18;
    
    // Ink particle trail effect
    float inkTrails = sin(radius4 * 4.2 + t * 0.25) * 0.06;
    col += vec3(0.8, 0.7, 0.9) * inkTrails;
    
    // Soft atmospheric vignette
    col *= (1.0 - smoothstep(1.5, 2.2, radius5));
    
    fragColor = vec4(col, 1.0);
}