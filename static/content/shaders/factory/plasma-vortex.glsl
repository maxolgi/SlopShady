// Name: Plasma Vortex
// Name: Plasma Vortex
// Swirling plasma tunnels with audio-reactive distortion and voice modulation

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
    for (int i = 0; i < 4; i++) {
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    
    // Audio reactivity
    float bass = texture(u_audioSpectrum, vec2(0.08, 0.5)).r;
    float mid = texture(u_audioSpectrum, vec2(0.4, 0.5)).r;
    float treble = texture(u_audioSpectrum, vec2(0.8, 0.5)).r;
    
    // Voice reactivity
    float voiceEnergy = 0.0;
    for (int i = 0; i < 4; i++) {
        if (u_voiceActive[i] > 0.5) {
            voiceEnergy += u_voiceVelocity[i] * u_voiceEG[i];
        }
    }
    
    vec3 col = vec3(0.0);
    
    // Polar coordinates for vortex
    float r = length(uv);
    float a = atan(uv.y, uv.x) + iTime * 0.8;
    
    // Spiral distortion
    float spiral = sin(a * 5.0 + iTime * 1.2) * 0.3;
    spiral += sin(a * 12.0 - iTime * 2.1) * 0.15;
    a += spiral / r * 0.5;
    
    // Audio-distorted radius
    r += bass * 0.2 - mid * 0.1;
    
    // Plasma rings
    float plasma = sin(r * 8.0 - iTime * 3.0) * 0.5 + 0.5;
    plasma *= sin(a * 7.0 + iTime * 2.5) * 0.5 + 0.5;
    plasma = pow(plasma, 2.0);
    
    // Tunnel effect
    float tunnel = 1.0 / (1.0 + r * 4.0);
    tunnel *= smoothstep(0.0, 0.3, plasma);
    
    // Voice modulation
    tunnel *= 0.5 + voiceEnergy * 1.5;
    
    // Color cycling
    vec3 plasmaColor1 = 0.5 + 0.5 * cos(vec3(0.0, 0.33, 0.67) * 6.28 + iTime * 1.5);
    vec3 plasmaColor2 = 0.5 + 0.5 * cos(vec3(0.2, 0.53, 0.87) * 6.28 + iTime * 2.0);
    
    col = mix(plasmaColor1, plasmaColor2, plasma);
    col *= tunnel;
    
    // Glow effect
    col += pow(plasma, 4.0) * vec3(1.0, 0.8, 0.4) * 0.8;
    
    // Background gradient
    vec3 bg = mix(vec3(0.01, 0.02, 0.1), vec3(0.1, 0.01, 0.05), r * 0.5);
    col = mix(bg, col, smoothstep(0.0, 1.0, col));
    
    // Audio-reactive vignette
    float vig = smoothstep(0.7, 0.2, length(uv) + treble * 0.3);
    col *= vig;
    
    fragColor = vec4(col, 1.0);
}
