// Name: Cyberpunk Neural Net
// Cyberpunk Neural Net
// A visualization of interconnected digital nodes pulsing with energy

#define NUM_NODES 20.0

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    float t = iTime * 0.5;
    
    vec3 final_col = vec3(0.02, 0.0, 0.05); // Dark background
    vec3 connection_col = vec3(0.0);
    vec3 node_col = vec3(0.0);

    for(int i = 0; i < int(NUM_NODES); ++i) {
        float seed = float(i) * 123.456;
        vec2 pos_i = vec2(fract(sin(seed * 0.123) * 43758.5453), fract(cos(seed * 0.456) * 43758.5453));
        pos_i += vec2(sin(t + seed) * 0.1, cos(t + seed * 1.2) * 0.1);
        float size_i = 0.008 + 0.004 * sin(t + seed);
        vec3 col_i = mix(vec3(0.0, 1.0, 1.0), vec3(1.0, 0.0, 1.0), fract(sin(seed) * 43758.5453));

        // Node brightness
        float d_node = distance(uv, pos_i);
        float node_glow = smoothstep(size_i * 2.0, 0.0, d_node);
        node_col += col_i * node_glow;

        for(int j = i + 1; j < int(NUM_NODES); ++j) {
            float seed_j = float(j) * 123.456;
            vec2 pos_j = vec2(fract(sin(seed_j * 0.123) * 43758.5453), fract(cos(seed_j * 0.456) * 43758.5453));
            pos_j += vec2(sin(t + seed_j) * 0.1, cos(t + seed_j * 1.2) * 0.1);
            float size_j = 0.008 + 0.004 * sin(t + seed_j);
            vec3 col_j = mix(vec3(0.0, 1.0, 1.0), vec3(1.0, 0.0, 1.0), fract(sin(seed_j) * 43758.5453));

            float dist_ij = distance(pos_i, pos_j);
            if(dist_ij < 0.25) {
                vec2 pa = pos_i;
                vec2 pb = pos_j;
                vec2 v = pb - pa;
                vec2 w = uv - pa;
                float l2 = dot(v,v);
                float t_proj = max(0.0, min(1.0, dot(w,v)/l2));
                vec2 projection = pa + t_proj*v;
                float dist_to_seg = distance(uv, projection);
                
                float line_glow = smoothstep(0.015, 0.0, dist_to_seg) * smoothstep(0.25, 0.0, dist_ij);
                connection_col += mix(col_i, col_j, 0.5) * line_glow;
            }
        }
    }

    final_col += connection_col + node_col;

    // Add some scanlines and noise for the cyberpunk feel
    float scanline = smoothstep(0.48, 0.5, sin(uv.y * 300.0));
    final_col *= (0.9 + 0.1 * scanline);
    
    float noise = fract(sin(dot(uv, vec2(12.9898, 78.233)) * 43758.5453)); // Fixed noise scale
    final_col += noise * 0.02;

    fragColor = vec4(final_col, 1.0);
}
