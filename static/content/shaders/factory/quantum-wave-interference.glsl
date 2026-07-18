// Name: Quantum Wave Interference
// Name: Quantum Wave Interference
// Wave-particle duality visualization with audio-driven probability clouds

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    uv = (uv - 0.5) * 2.0 * iResolution.xy / iResolution.yy;
    
    vec3 col = vec3(0.0);
    
    // Audio-driven wave parameters
    float freqLow = texture(u_audioSpectrum, vec2(0.1, 0.5)).r;
    float freqHigh = texture(u_audioSpectrum, vec2(0.7, 0.5)).r;
    float waveSpeed = 2.0 + freqLow * 3.0;
    float interference = freqHigh * 4.0;
    
    // Voice probability collapse
    float probability = 0.0;
    for (int i = 0; i < 4; i++) {
        if (u_voiceActive[i] > 0.5) {
            probability += u_voiceEG[i] * u_voiceVelocity[i];
        }
    }
    
    // Multiple wave sources
    float waves = 0.0;
    vec2 sources[5];
    sources[0] = vec2(-0.8, 0.6);
    sources[1] = vec2(0.8, -0.4);
    sources[2] = vec2(0.0, -0.8);
    sources[3] = vec2(-0.5, -0.2);
    sources[4] = vec2(0.6, 0.3);
    
    for (int i = 0; i < 5; i++) {
        vec2 source = sources[i];
        float phase = iTime * waveSpeed + float(i) * 0.8;
        float dist = length(uv - source);
        waves += sin(dist * 15.0 - phase) * exp(-dist * 2.0);
    }
    
    // Interference pattern
    float pattern = sin(waves * 3.0 + interference) * 0.5 + 0.5;
    pattern = smoothstep(0.4, 0.6, pattern);
    
    // Probability cloud texture
    vec2 cloudUV = uv * 3.0 + vec2(iTime * 0.3, sin(iTime * 0.4) * 0.2);
    float cloud = noise(cloudUV * 4.0) * 0.7;
    cloud += noise(cloudUV * 8.0) * 0.3;
    cloud = pow(cloud * 1.2, 1.5);
    
    // Wavefunction collapse
    float collapsed = mix(pattern * cloud, cloud, probability);
    
    // Color based on wave intensity
    float intensity = collapsed;
    vec3 waveColor = hsv2rgb(vec3(
        fract(iTime * 0.1 + uv.x * 0.1),
        0.8 + freqLow * 0.2,
        intensity * 2.0
    ));
    
    col += waveColor * intensity;
    
    // Particle traces when voices trigger
    if (probability > 0.1) {
        vec2 particleUV = fract(uv * 10.0 + iTime * 5.0 + probability * 20.0);
        float particle = step(0.98, hash(floor(uv * 10.0) + vec2(iTime * 10.0)));
        col += vec3(1.0, 1.0, 0.8) * particle * probability * 3.0;
    }
    
    // Glow trails
    float glow = smoothstep(0.3, 0.7, pattern) * (1.0 - probability);
    col += hsv2rgb(vec3(fract(iTime * 0.2), 1.0, 1.0)) * glow * 0.8;
    
    // Dark vacuum background
    col = pow(col, vec3(0.8));
    
    // Screen distortion
    vec2 distort = vec2(
        sin(uv.y * 10.0 + iTime * 20.0) * 0.02,
        cos(uv.x * 8.0 + iTime * 15.0) * 0.01
    ) * freqHigh;
    col *= texture(u_audioWaveform, vec2(uv.x + distort.x, 0.5)).r * 0.5 + 0.5;
    
    // Quantum flicker
    col *= 0.8 + 0.2 * fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
    
    fragColor = vec4(col, 1.0);
}
