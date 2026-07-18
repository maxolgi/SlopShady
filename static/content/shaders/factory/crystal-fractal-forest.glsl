// Name: Crystal Fractal Forest
// Name: Crystal Fractal Forest
// Infinite fractal trees with crystal growth, voice-triggered blooming, audio wind

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
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

float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 6; i++) {
        v += a * noise(p);
        p *= 2.1;
        a *= 0.48;
    }
    return v;
}

// Distance field for tree branches
float treeDF(vec2 p, float time) {
    float branch = fbm(p * 2.0 + vec2(time * 0.1, 0.0)) * 0.5;
    return abs(p.y - branch * exp(-length(p.x) * 3.0)) - 0.02;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    uv *= 1.5;
    
    // Audio wind
    float windStrength = texture(u_audioSpectrum, vec2(0.15, 0.5)).r * 2.0;
    float wind = sin(iTime * 0.3 + uv.x * 3.0 + windStrength * 5.0) * 0.1;
    
    vec3 col = vec3(0.02, 0.05, 0.1); // Night sky
    
    // Voice bloom energy
    float bloomEnergy = 0.0;
    for (int i = 0; i < 4; i++) {
        if (u_voiceActive[i] > 0.5) {
            bloomEnergy += u_voiceEG[i] * u_voiceVelocity[i] * (u_voiceNote[i] / 127.0);
        }
    }
    
    // Fractal tree iteration
    vec2 p = uv;
    p.x += wind;
    
    float d = 1e10;
    float glow = 0.0;
    
    for (float i = 0.0; i < 7.0; i++) {
        float scale = exp2(i * 0.7);
        vec2 q = p * scale;
        q.x += sin(iTime * 0.5 + i * 2.1) * 0.3;
        
        float branchDist = treeDF(q, iTime);
        d = min(d, branchDist / scale);
        
        // Crystal facets
        float crystal = sin(q.x * 12.0) * sin(q.y * 15.0) * 0.5 + 0.5;
        crystal = smoothstep(0.7, 0.8, crystal);
        glow += crystal * exp(-branchDist * 10.0) / scale * 0.3;
    }
    
    // Tree rendering
    float tree = 1.0 - smoothstep(0.0, 0.01, d);
    tree *= smoothstep(-0.5, 0.0, uv.y);
    
    // Leaves/crystals
    float leaves = fbm(uv * 8.0 + vec2(iTime * 0.2, 0.0)) * tree;
    leaves = smoothstep(0.4, 0.6, leaves);
    
    // Bloom effect from voices
    leaves += bloomEnergy * 2.0 * smoothstep(0.0, 0.3, tree);
    
    // Ground reflection
    float ground = smoothstep(-0.6, -0.65, uv.y);
    vec3 groundCol = vec3(0.1, 0.08, 0.05);
    col = mix(col, groundCol, ground);
    
    // Crystal colors
    vec3 crystalColor = 0.5 + 0.5 * cos(vec3(0.0, 0.33, 0.67) * 6.28 + iTime + bloomEnergy * 10.0);
    col += crystalColor * glow * 3.0;
    col += vec3(0.8, 0.6, 1.0) * leaves * 0.8;
    col += vec3(1.0, 0.9, 0.6) * tree * 0.4;
    
    // Fog
    col *= exp(-length(uv) * 0.3);
    
    // Stars
    vec2 starUV = gl_FragCoord.xy / iResolution.xy;
    float stars = step(0.995, hash(floor(starUV * 200.0) + fract(sin(iTime) * 123.45)));
    col += stars * 0.8 * (0.5 + 0.5 * sin(iTime * 10.0));
    
    fragColor = vec4(col, 1.0);
}
