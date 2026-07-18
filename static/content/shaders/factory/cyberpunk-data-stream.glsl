// Name: Cyberpunk Data Stream
// Cyberpunk Data Stream
// A 3D-perspective neon grid with moving data packets and heavy glitching

float hash(vec2 p) {
    p = fract(p * vec2(127.1, 301.7));
    p += dot(p, p.xy + 10.0);
    return fract(p.x * p.y);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

mat2 rot(float a) {
    float s = sin(a), c = cos(a);
    return mat2(c, -s, s, c);
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    uv = uv * 2.0 - 1.0;
    uv.x *= iResolution.x / iResolution.y;

    float t = iTime;

    // --- Glitch & Distortion ---
    float glitch_mask = step(0.96, sin(t * 3.0 + hash(vec2(t)) * 10.0));
    float distortion = (noise(vec2(t * 0.5, uv.y * 5.0)) - 0.5) * 0.15 * glitch_mask;
    uv.x += distortion;

    // --- Pseudo-3D Perspective Transform ---
    // We'll warp the UVs to create a floor effect
    float plane_z = 0.5; // Distance of the plane
    float perspective = 1.0 / (plane_z - uv.y); 
    vec2 p_uv = uv;
    p_uv.x *= perspective;
    p_uv.y *= perspective * 0.5; // Flatten the Y axis

    // --- Grid Setup ---
    float gridSize = 12.0;
    // We use a large scale and modulo to create the grid lines on the warped plane
    vec2 gridUV = fract(p_uv * gridSize) - 0.5;
    
    // Line thickness and glow
    float lineThickness = 0.04;
    float edgeDist = min(abs(gridUV.x), abs(gridUV.y));
    float lines = smoothstep(lineThickness, 0.0, edgeDist);

    // --- Color Palette ---
    vec3 deepBlack = vec3(0.02, 0.01, 0.05);
    vec3 neonCyan = vec3(0.0, 1.0, 1.0);
    vec3 neonMagenta = vec3(1.0, 0.0, 1.0);

    // Pulse effect based on time and position
    float pulse = sin(t * 2.5 + p_uv.x * 2.0) * 0.5 + 0.5;
    vec3 gridColor = mix(neonCyan, neonMagenta, pulse);

    // --- Data Packets (Moving Blobs) ---
    // We'll use a moving sine wave in the UV space to represent "packets"
    float packet_speed = 2.0;
    float packet_pos = fract(t * packet_speed + p_uv.x);
    float packet_wave = sin(p_uv.x * 10.0 - t * 5.0) * 0.5 + 0.5;
    float packets = step(0.9, smoothstep(0.4, 0.5, abs(gridUV.x - 0.5)) * step(0.9, smoothstep(0.4, 0.5, abs(gridUV.y - 0.5))) * packet_wave);
    // Wait, that's too complex for a simple line. Let's use a simpler "blob" in the grid cells.
    float blob = smoothstep(0.2, 0.0, length(gridUV) - (0.1 + 0.3 * packet_wave));
    vec3 packetColor = mix(neonCyan, neonMagenta, sin(t * 5.0) * 0.5 + 0.5);

    // --- Final Composition ---
    vec3 col = deepBlack;
    
    // Add the grid lines
    col += lines * gridColor * (0.4 + pulse * 0.6);
    
    // Add the moving blobs (data packets)
    col += blob * packetColor * 1.5;

    // Add a subtle scanline effect
    float scanline = sin(uv.y * 300.0 + t * 1.0) * 0.02;
    col += scanline;

    // Add grain/noise
    float grain = (noise(uv + t * 0.1) - 0.5) * 0.08;
    col += grain;

    // Vignette to focus on the center "floor"
    float vignette = smoothstep(1.2, 0.4, length(uv));
    col *= vignette;

    fragColor = vec4(col, 1.0);
}
