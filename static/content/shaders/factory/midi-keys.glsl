// Name: MIDI Keys
// Visual piano keyboard showing active MIDI notes with colored glow

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    vec3 col = vec3(0.02, 0.02, 0.06);

    float startNote = 48.0;
    float numKeys = 36.0;
    float kbTop = 0.85;
    float kbBot = 0.15;

    if (uv.y >= kbBot && uv.y <= kbTop) {
        float keyIdx = floor(uv.x * numKeys);
        float noteNum = startNote + keyIdx;
        float keyLeft = keyIdx / numKeys;
        float keyRight = (keyIdx + 1.0) / numKeys;
        float nio = mod(noteNum, 12.0);

        float isBlack = step(0.5,
            step(abs(nio - 1.0), 0.5) + step(abs(nio - 3.0), 0.5) +
            step(abs(nio - 6.0), 0.5) + step(abs(nio - 8.0), 0.5) +
            step(abs(nio - 10.0), 0.5));

        vec3 keyColor = mix(vec3(0.55, 0.55, 0.6), vec3(0.08, 0.08, 0.12), isBlack);

        float activation = 0.0;
        for (int i = 0; i < 4; i++) {
            if (u_voiceActive[i] > 0.5) {
                if (abs(u_voiceNote[i] - noteNum) < 0.5) {
                    activation += u_voiceVelocity[i] * u_voiceEG[i];
                }
            }
        }
        activation = clamp(activation, 0.0, 1.0);

        float hue = nio / 12.0;
        vec3 activeColor = hsv2rgb(vec3(hue, 0.85, 1.0));
        col = mix(keyColor, activeColor, activation);

        float borderX = min(uv.x - keyLeft, keyRight - uv.x);
        col *= 0.4 + 0.6 * smoothstep(0.0, 0.003, borderX);

        if (activation > 0.01) {
            col += activeColor * activation * smoothstep(kbTop, kbTop + 0.15, uv.y) * 0.4;
        }
    }

    for (int i = 0; i < 4; i++) {
        if (u_voiceActive[i] > 0.5) {
            float noteX = (u_voiceNote[i] - startNote + 0.5) / numKeys;
            float dist = abs(uv.x - noteX);
            float vel = u_voiceVelocity[i] * u_voiceEG[i];
            float glow = 0.008 / (dist + 0.008) * vel;
            col += hsv2rgb(vec3(mod(u_voiceNote[i], 12.0) / 12.0, 0.8, 1.0)) * glow * 0.15;
        }
    }

    fragColor = vec4(col, 1.0);
}
