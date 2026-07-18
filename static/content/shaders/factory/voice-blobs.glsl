// Name: Voice Blobs
// Per-voice glowing orbs positioned by note pitch, colored by note class

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    vec3 col = vec3(0.01, 0.01, 0.03);

    float spread = 0.7;
    float baseSize = 0.12;
    float noteMin = 36.0;
    float noteMax = 96.0;

    for (int i = 0; i < 4; i++) {
        if (u_voiceActive[i] < 0.5) continue;
        float note = u_voiceNote[i];
        float vel = u_voiceVelocity[i];
        float eg = u_voiceEG[i];

        float nx = spread * ((note - noteMin) / (noteMax - noteMin) * 2.0 - 1.0);
        float ny = 0.15 * sin(iTime * 0.6 + float(i) * 1.57);
        vec2 pos = vec2(nx, ny);

        float dist = length(uv - pos);
        float size = baseSize * (0.5 + vel * 0.5);
        float intensity = eg * vel;

        float blob = exp(-dist * dist / (size * size * 0.5));
        float glow = exp(-dist * 4.0) * 0.3;

        float hue = mod(note, 12.0) / 12.0;
        vec3 blobColor = hsv2rgb(vec3(hue, 0.75, 1.0));

        col += blobColor * (blob + glow) * intensity;
    }

    col = clamp(col, 0.0, 1.0);
    fragColor = vec4(col, 1.0);
}
