// Name: Ethereal Underwater Flow - Deep Ocean Gradient Shader
// Ethereal Underwater Flow - Deep Ocean Gradient Shader
// (Cool flowing gradients with aquatic organic patterns)
vec3 palette(float t, float i) {
    // Deep ocean gradient mixing teal, cyan, and deep blue tones
    vec3 a = vec3(0.15, 0.2, 0.4);     // Deep midnight blue base
    vec3 b = vec3(0.4, 0.85, 0.95);    // Bright aqua highlight
    vec3 c = vec3(0.7, 0.6, 0.5);      // Seafoam green accent
    vec3 d = vec3(0.1, 0.15, 0.25);   // Deep indigo shadow
    return a + b * cos(6.28318 * (c * t + d)) + c * sin(6.28318 * (t + i));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    
    float t = iTime * 0.18; // Gentle ocean current
    
    vec3 col = vec3(0.0);
    
    // Layer 1: Deep water currents with flowing motion
    vec2 p = uv;
    float angle1 = atan(p.y, p.x) + t * 0.55;
    float radius1 = length(p);
    float layer1 = sin(radius1 * 1.9 - angle1 * 4.2 + t);
    
    // Layer 2: Bubbles and rising particles
    vec2 q = uv;
    float angle2 = atan(q.y, q.x) + t * 0.35;
    float radius2 = length(q);
    float layer2 = cos(radius2 * 1.4 - angle2 * 3.5 + t * 0.8);
    
    // Layer 3: Reef-like organic structures
    vec2 r = uv;
    float angle3 = atan(r.y, r.x) + t * 0.25;
    float radius3 = length(r);
    float layer3 = sin(radius3 * 0.9 - angle3 * 6.0 + t * 0.6);
    
    // Layer 4: Light refraction through water
    vec2 s = uv;
    float angle4 = atan(s.y, s.x) + t * 0.7;
    float radius4 = length(s);
    float layer4 = cos(radius4 * 2.2 - angle4 * 2.8 + t * 0.4);
    
    // Layer 5: Ocean depth variation
    vec2 d = uv;
    float angle5 = atan(d.y, d.x) + t * 0.45;
    float radius5 = length(d);
    float layer5 = sin(radius5 * 3.1 - angle5 * 1.6 + t * 0.2);
    
    // Combine layers with weighted aquatic influence
    float combined = layer1 * 0.22 + layer2 * 0.18 + layer3 * 0.2 + layer4 * 0.22 + layer5 * 0.18;
    
    // Map to ocean palette
    col = palette(combined * 0.4 + t, length(uv));
    
    // Add bioluminescent glow at edges
    float glow = smoothstep(1.6, 2.1, radius5);
    col += vec3(0.8, 0.95, 1.0) * glow * 0.15;
    
    // Water surface shimmer overlay
    float shimmer = sin(radius4 * 3.5 + t * 0.3) * 0.06;
    col += vec3(0.2, 0.5, 0.8) * shimmer;
    
    // Depth vignette for underwater feel
    col *= (1.0 - smoothstep(1.4, 1.9, radius3));
    
    fragColor = vec4(col, 1.0);
}