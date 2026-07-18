// Name: Metaball Organism
// Name: Metaball Organism
// Pulsating organic metaballs with voice-controlled mutation and audio breathing

float hash(vec2 p) {
    p = 50.0 * fract(p * 0.3183099 + vec2(0.71, 0.113));
    return fract(p.x * p.y * (p.x + p.y));
}

float metaball(vec2 p, vec2 center, float r) {
    float d = length(p - center);
    return 1.0 / (1.0 + d * d / (r * r));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    uv *= 2.0;
    
    vec3 col = vec3(0.08, 0.02, 0.15);
    
    // Audio breathing
    float breathLow = texture(u_audioSpectrum, vec2(0.05, 0.5)).r;
    float breathMid = texture(u_audioSpectrum, vec2(0.3, 0.5)).r;
    float breath = 0.7 + breathLow * 0.8 + breathMid * 0.3;
    
    // Voice control - position, size, mutation
    vec4 voiceCenters[4];
    float voiceRadii[4];
    float voiceMutation[4];
    
    for (int i = 0; i < 4; i++) {
        if (u_voiceActive[i] > 0.5) {
            float t = iTime * 0.8 + float(i) * 1.57;
            float noteFreq = u_voiceNote[i] / 127.0;
            
            voiceCenters[i] = vec4(
                sin(t + noteFreq * 6.28) * 0.8,
                cos(t * 0.7 + noteFreq * 4.0) * 0.6,
                0.0, 1.0
            ) * u_voiceEG[i] * u_voiceVelocity[i];
            
            voiceRadii[i] = 0.4 + u_voiceVelocity[i] * 0.3 + breath * 0.1;
            voiceMutation[i] = u_voiceEG[i] * sin(t * 3.0 + noteFreq * 10.0) * 0.5;
        } else {
            voiceCenters[i] = vec4(10.0, 10.0, 0.0, 0.0);
            voiceRadii[i] = 0.0;
            voiceMutation[i] = 0.0;
        }
    }
    
    // Main metaball field
    float totalField = 0.0;
    vec2 closestCenter = vec2(0.0);
    float closestDist = 1e10;
    
    for (int i = 0; i < 4; i++) {
        if (voiceCenters[i].w > 0.1) {
            vec2 center = voiceCenters[i].xy + voiceMutation[i] * vec2(
                sin(iTime * 4.0 + float(i)),
                cos(iTime * 5.0 + float(i) * 2.0)
            );
            
            float field = metaball(uv, center, voiceRadii[i]);
            totalField += field * voiceCenters[i].w;
            
            float dist = length(uv - center);
            if (dist < closestDist) {
                closestDist = dist;
                closestCenter = center;
            }
        }
    }
    
    // Additional breathing blobs
    for (float i = 0.0; i < 3.0; i++) {
        vec2 center = vec2(
            sin(iTime * 0.4 + i * 2.0) * 1.2,
            cos(iTime * 0.3 + i * 3.0) * 0.8
        ) * breath;
        float r = 0.25 + sin(iTime * 2.0 + i) * 0.1;
        totalField += metaball(uv, center, r) * 0.4;
    }
    
    // Blob shape
    float blob = smoothstep(1.1, 0.9, totalField);
    float edgeGlow = smoothstep(1.2, 0.8, totalField) - blob;
    
    // Color based on proximity to centers
    vec3 blobColor = vec3(0.9, 0.4, 1.0);
    if (closestDist < 1.0) {
        float hue = (atan(closestCenter.y, closestCenter.x) + 3.14159) / 6.28318;
        blobColor = vec3(0.8, 0.5 + breath * 0.3, 1.0) * (0.5 + 0.5 * sin(hue * 6.28 + iTime));
    }
    
    col += blobColor * blob * 1.5;
    col += blobColor * 2.0 * edgeGlow;
    
    // Internal pulsing veins
    float veins = sin(uv.x * 20.0 + iTime * 10.0) * sin(uv.y * 15.0 - iTime * 8.0) * 0.5 + 0.5;
    veins *= smoothstep(0.8, 1.1, totalField);
    col += vec3(1.0, 0.7, 0.9) * veins * 0.6;
    
    // Specular highlights
    vec2 lightDir = normalize(vec2(0.7, 0.4));
    float spec = pow(max(0.0, dot(normalize(uv - closestCenter), lightDir)), 32.0);
    col += vec3(1.0, 0.9, 0.8) * spec * blob * 2.0;
    
    // Background gradient with breath
    vec3 bgGrad = mix(
        vec3(0.1, 0.02, 0.2),
        vec3(0.3, 0.1, 0.4),
        pow(length(uv) * 0.5 + breath * 0.2, 2.0)
    );
    col = mix(bgGrad, col, smoothstep(0.0, 1.0, col));
    
    // Vignette
    float vig = 1.0 - length(uv) * 0.3;
    col *= vig * vig;
    
    fragColor = vec4(col, 1.0);
}
