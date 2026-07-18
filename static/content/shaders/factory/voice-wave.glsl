// Name: Voice Wave
// Additive sine waves driven by MIDI voice notes

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    vec3 col = vec3(0.01, 0.01, 0.04);

    float baseY = 0.5;
    float amplitude = 0.15;
    float noteScale = 0.08;

    for (int i = 0; i < 4; i++) {
        if (u_voiceActive[i] < 0.5) continue;

        float note = u_voiceNote[i];
        float vel = u_voiceVelocity[i];
        float eg = u_voiceEG[i];

        float freq = noteScale * (note - 40.0);
        float phase = freq * uv.x * 6.28318 + iTime * 2.5;
        float wave = sin(phase) * amplitude * vel * eg;

        float y = baseY + wave;
        float dist = abs(uv.y - y);

        float thickness = 0.004 + vel * 0.003;
        float line = smoothstep(thickness + 0.002, thickness - 0.002, dist);
        float glow = exp(-dist * 50.0) * 0.25 * vel * eg;

        float hue = mod(note, 12.0) / 12.0;
        vec3 waveColor = hsv2rgb(vec3(hue, 0.8, 1.0));

        col += waveColor * (line + glow);
    }

    float centerLine = smoothstep(0.002, 0.0, abs(uv.y - baseY)) * 0.08;
    col += vec3(0.2, 0.25, 0.4) * centerLine;

    fragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
