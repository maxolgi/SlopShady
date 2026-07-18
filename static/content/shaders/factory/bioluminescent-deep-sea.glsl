// Name: Bioluminescent Deep Sea Ecosystem
// Bioluminescent Deep Sea Ecosystem
// Living organisms swimming through the abyssal darkness

#define NUM_ORGS 15.0
#define NUM_PARTICLES 80.0

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    float t = iTime * 0.3;
    
    // Deep ocean background with gradient
    vec3 final_col = mix(vec3(0.0, 0.02, 0.05), vec3(0.0, 0.01, 0.03), uv.y);
    
    // Bioluminescent organisms
    for(float i = 0.0; i < NUM_ORGS; i++) {
        float seed = hash(vec2(floor(i), floor(t * 10.0)));
        vec2 org_pos = vec2(seed, hash(vec2(seed + 1.0))) * 0.8 + 0.1;
        
        // Organic movement patterns
        vec2 vel = vec2(sin(t * 2.0 + i * 3.0), cos(t * 1.5 + i * 4.0));
        org_pos += vel * sin(t * 0.8 + i) * 0.02;
        
        // Organism color based on type
        vec3 org_col = mix(vec3(0.1, 0.6, 0.9), vec3(0.5, 0.9, 0.7), seed);
        float glow_strength = 0.4 + 0.4 * sin(t * 2.0 + i * 5.0);
        
        float d_org = distance(uv, org_pos);
        float organism_glow = exp(-d_org * 15.0) * glow_strength;
        final_col += org_col * organism_glow;
        
        // Connection trails between organisms
        for(float j = i + 1.0; j < NUM_ORGS; j++) {
            float seed_j = hash(vec2(floor(j), floor(t * 10.0)));
            vec2 pos_j = vec2(seed_j, hash(vec2(seed_j + 1.0))) * 0.8 + 0.1;
            
            vec2 vel_j = vec2(sin(t * 2.0 + j * 3.0), cos(t * 1.5 + j * 4.0));
            pos_j += vel_j * sin(t * 0.8 + j) * 0.02;
            
            float dist_ij = distance(org_pos, pos_j);
            if(dist_ij < 0.35) {
                vec2 mid_pt = (org_pos + pos_j) * 0.5;
                float d_mid = distance(uv, mid_pt);
                float trail = exp(-d_mid * 12.0) * (1.0 - dist_ij/0.35);
                
                // Connect with bioluminescent light
                vec3 connection_col = mix(org_col, org_col * seed_j, 0.6);
                final_col += connection_col * trail;
            }
        }
    }
    
    // Floating particles
    for(float i = 0.0; i < NUM_PARTICLES; i++) {
        float seed_p = hash(vec2(floor(i), floor(t)));
        vec2 pos_p = vec2(seed_p, hash(vec2(seed_p + 1.0))) * 0.9 + 0.05;
        
        // Particle movement with current
        pos_p += vec2(sin(t * 3.0 + i) * 0.03, cos(t * 2.0 + i) * 0.03);
        pos_p = fract(pos_p * 1.0) * 0.95;
        
        float size_p = 0.003 + 0.004 * sin(t * 3.0 + i);
        vec3 part_col = mix(vec3(0.2, 0.8, 1.0), vec3(0.7, 0.9, 0.6), seed_p);
        
        float d_part = distance(uv, pos_p);
        float particle_glow = exp(-d_part / size_p) * (0.5 + 0.5 * sin(t * 4.0 + i));
        final_col += part_col * particle_glow;
    }
    
    // Subtle water caustics effect
    float caustic = sin(uv.x * 10.0 - t) * sin(uv.y * 8.0 - t * 0.7);
    final_col += vec3(0.0, 0.15, 0.25) * caustic * 0.08;
    
    // Vignette for depth feeling
    float vignette = smoothstep(1.0, 0.6, length(uv - 0.5));
    final_col *= vignette;
    
    fragColor = vec4(final_col, 1.0);
}
