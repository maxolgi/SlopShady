// Name: Fractal Flow Cascade - Complex Recursive Pattern Shader
// Fractal Flow Cascade - Complex Recursive Pattern Shader
// (Multi-layered fractal flow with vibrant color cycling)
vec3 palette(float t, float i) {
    // Vibrant multi-hue gradient with flowing colors
    vec3 a = vec3(0.2, 0.1, 0.5);      // Deep purple base
    vec3 b = vec3(0.95, 0.4, 0.1);    // Orange-red highlight
    vec3 c = vec3(0.8, 0.6, 1.0);     // Lavender accent
    vec3 d = vec3(0.05, 0.1, 0.2);    // Dark violet shadow
    return a + b * cos(6.28318 * (c * t + d)) + c * sin(6.28318 * (t + i));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    
    float t = iTime * 0.2; // Medium flow speed
    
    vec3 col = vec3(0.0);
    
    // Layer 1: Primary fractal cascade with recursive waves
    vec2 p = uv;
    float angle1 = atan(p.y, p.x) + t * 0.65;
    float radius1 = length(p);
    float layer1 = sin(radius1 * 2.8 - angle1 * 4.8 + t) * 0.7;
    
    // Layer 2: Secondary fractal with inverted frequency
    vec2 q = uv;
    float angle2 = atan(q.y, q.x) + t * 0.5;
    float radius2 = length(q);
    float layer2 = cos(radius2 * 2.1 - angle2 * 3.6 + t * 0.4) * 0.6;
    
    // Layer 3: Tertiary fractal with radial symmetry
    vec2 r = uv;
    float angle3 = atan(r.y, r.x) + t * 0.45;
    float radius3 = length(r);
    float layer3 = sin(radius3 * 1.7 - angle3 * 5.5 + t * 0.6) * 0.5;
    
    // Layer 4: Quaternary fractal with high frequency detail
    vec2 s = uv;
    float angle4 = atan(s.y, s.x) + t * 0.75;
    float radius4 = length(s);
    float layer4 = cos(radius4 * 3.8 - angle4 * 2.4 + t * 0.35) * 0.4;
    
    // Layer 5: Pentagonal fractal with sharp transitions
    vec2 core = uv;
    float angle5 = atan(core.y, core.x) + t * 0.85;
    float radius5 = length(core);
    float layer5 = abs(sin(radius5 * 4.5 - angle5 * 1.9 + t)) * 0.3;
    
    // Layer 6: Central vortex with intense motion
    vec2 vortex = uv;
    float angle6 = atan(vortex.y, vortex.x) + t * 0.95;
    float radius6 = length(vortex);
    float layer6 = sin(radius6 * 3.2 - angle6 * 2.8 + t * 0.7) * 0.45;
    
    // Combine all fractal layers with weighted influence
    float combined = layer1 * 0.18 + layer2 * 0.17 + layer3 * 0.17 + 
                     layer4 * 0.16 + layer5 * 0.14 + layer6 * 0.18;
    
    // Map to vibrant fractal palette
    col = palette(combined * 0.45 + t, length(uv));
    
    // Add central vortex glow for depth
    float vortexGlow = smoothstep(0.7, 1.3, radius6);
    col += vec3(1.0, 0.9, 0.8) * vortexGlow * 0.2;
    
    // Fractal edge shimmer effect
    float fractalShimmer = sin(radius4 * 4.5 + t * 0.2) * 0.07;
    col += vec3(0.9, 0.85, 1.0) * fractalShimmer;
    
    // Deep space vignette for atmosphere
    col *= (1.0 - smoothstep(1.4, 1.9, radius5));
    
    fragColor = vec4(col, 1.0);
}