// Name: Plasma Vortex Reactor - Hyper-Responsive Audio + Voice Reactive
// Plasma Vortex Reactor - Hyper-Responsive Audio + Voice Reactive
// Infinite swirling plasma energy field with audio spectrum rings and voice note mapping

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

vec3 hsv2rgb(vec3 hsv) {
    vec3 rgb = clamp(abs(mod(hsv.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return hsv.z * mix(vec3(1.0), rgb, hsv.y);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    
    // Core rotation + spiral motion (dial-friendly speed)
    float t = iTime * 0.8;
    float angle = t * 0.5 + length(uv) * 5.0;
    vec2 spiralUV = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * uv;
    
    // Multi-octave plasma field
    float plasma = 0.0;
    float freq = 1.5;
    for (int i = 0; i < 6; i++) {
        plasma += sin(spiralUV.x * freq * 8.0 + t * 2.0) * sin(spiralUV.y * freq * 8.0 + t * 2.0) * 0.5;
        spiralUV *= 2.0;
        freq *= 1.9;
    }
    
    // AUDIO SPECTRUM REACTIVITY - Radial frequency rings
    float bass = texture(u_audioSpectrum, vec2(0.08, 0.5)).r;
    float mid = texture(u_audioSpectrum, vec2(0.35, 0.5)).r;
    float high = texture(u_audioSpectrum, vec2(0.75, 0.5)).r;
    
    float r = length(uv);
    float audioPulse = sin(r * 15.0 - t * 3.0) * (bass * 2.0);
    audioPulse += sin(r * 25.0 + t * 4.0) * (mid * 1.5);
    audioPulse += sin(r * 45.0 - t * 6.0) * (high * 2.0);
    
    // VOICE REACTIVITY - Note-based hue + velocity glow
    float voiceEnergy = 0.0;
    float voiceHue = 0.0;
    for (int i = 0; i < 4; i++) {
        if (u_voiceActive[i] > 0.5) {
            voiceEnergy += u_voiceVelocity[i] * u_voiceEG[i];
            voiceHue += (u_voiceNote[i] / 127.0) * u_voiceEG[i];
        }
    }
    
    // Distance-based plasma rings modulated by audio
    float rings = sin(r * 12.0 + audioPulse * 3.0 - t) * 0.7;
    rings += sin(r * 22.0 + t * 1.5) * 0.4;
    
    // Core plasma glow
    float glow = 1.0 / (1.0 + r * 3.0);
    glow *= smoothstep(0.0, 1.0, plasma + rings + 0.3);
    
    // Voice-driven hue shift
    vec3 col = hsv2rgb(vec3(voiceHue * 0.3 + t * 0.1 + r * 0.5, 0.9, glow));
    
    // Audio intensity boost
    col *= 0.8 + bass * 1.2 + mid * 0.8 + high * 1.5;
    
    // Voice energy explosion effect
    col += hsv2rgb(vec3(voiceHue, 1.0, 1.0)) * voiceEnergy * 2.0 * glow;
    
    // Dynamic vignette + edge flare
    float vignette = 1.0 - r * 0.7;
    col *= vignette;
    col += pow(glow * high, 4.0) * vec3(2.0, 1.5, 1.0) * 0.5;
    
    // Final contrast punch + layer brightness response
    col = pow(col, vec3(0.8));
    col *= 1.0 + u_brightness * 0.3;
    
    fragColor = vec4(col, 1.0);
}