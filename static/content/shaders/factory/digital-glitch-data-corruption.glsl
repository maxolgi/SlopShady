// Name: Digital Glitch / Data Corruption
// Digital Glitch / Data Corruption
// (A chaotic, high-contrast shader with RGB splitting and pixelated tearing)
float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    float t = iTime;
    
    // --- Part 1: Blocky Pixelation/Tearing ---
    float scale = 150.0;
    vec2 block_uv = floor(uv * scale) / scale;
    
    // Random offset for the blocks (the "tear")
    float glitch_chance = 0.15;
    float noise = hash(block_uv + floor(t * 8.0)); // Changes every 0.125s
    vec2 offset = vec2(0.0);
    if (noise < glitch_chance) {
        offset += vec2(hash(block_uv + t) - 0.5, hash(block_uv + t * 1.5) - 0.5) * 0.15;
    }
    
    // --- Part 2: RGB Splitting (Chromatic Aberration) ---
    float shift_r = 0.02 + 0.03 * sin(t * 5.0);
    float shift_b = -0.02 - 0.03 * cos(t * 4.0);
    
    vec2 uv_r = block_uv + offset + vec2(shift_r, 0.0);
    vec2 uv_g = block_uv + offset;
    vec2 uv_b = block_uv + offset + vec2(shift_b, 0.0);

    // A base color pattern (let's use a simple moving stripe/noise)
    float pattern = sin(block_uv.x * 15.0 + t) * cos(block_uv.y * 15.0 - t);
    
    float r = pattern + hash(uv_r + t * 0.5);
    float g = pattern;
    float b = pattern + hash(uv_b + t * 1.2);
    
    vec3 col = vec3(r, g, b);
    
    // --- Part 3: Scanlines & Noise ---
    float scanline = sin(gl_FragCoord.y * 2.5) * 0.1 + 0.9;
    col *= scanline;
    
    float static_noise = hash(uv + t) * 0.15;
    col += static_noise;

    // Final brightness/contrast boost
    col = mix(col, col * col, 0.3); // Slight contrast
    col = smoothstep(0.0, 1.0, col); // Crush blacks for punchy look
    
    fragColor = vec4(col, 1.0);
}
