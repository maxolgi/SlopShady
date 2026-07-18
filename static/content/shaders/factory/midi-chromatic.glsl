// Name: MIDI Chromatic
// 12-segment color wheel mapped to pitch classes, lit by active voices

vec3 hsv2rgb(vec3 c) {
    vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
    vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
    return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    vec3 col = vec3(0.02, 0.02, 0.05);

    float dist = length(uv);
    float angle = atan(uv.y, uv.x);
    float normAngle = (angle + 3.14159265) / 6.28318;
    float segmentIdx = floor(normAngle * 12.0);
    float segmentHue = segmentIdx / 12.0;
    float segCenter = (segmentIdx + 0.5) / 12.0;
    float angleDist = abs(normAngle - segCenter);
    angleDist = min(angleDist, 1.0 - angleDist) * 12.0;

    float innerR = 0.12;
    float outerR = 0.45;

    float ringMask = smoothstep(innerR - 0.005, innerR + 0.005, dist)
                   * smoothstep(outerR + 0.005, outerR - 0.005, dist);

    float segBorder = smoothstep(0.04, 0.06, angleDist);
    vec3 segColor = hsv2rgb(vec3(segmentHue, 0.6, 0.15));

    float activation = 0.0;
    float actVelocity = 0.0;
    for (int i = 0; i < 4; i++) {
        if (u_voiceActive[i] < 0.5) continue;
        float pitchClass = mod(u_voiceNote[i], 12.0);
        if (abs(pitchClass - segmentIdx) < 0.5) {
            float contribution = u_voiceVelocity[i] * u_voiceEG[i];
            activation += contribution;
            actVelocity += contribution;
        }
    }
    activation = clamp(activation, 0.0, 1.0);

    vec3 activeColor = hsv2rgb(vec3(segmentHue, 0.85, 1.0));
    col = mix(segColor, activeColor, activation) * ringMask * segBorder;

    float glow = exp(-abs(dist - (innerR + outerR) * 0.5) * 6.0) * activation * 0.2;
    float glowMask = glow * (1.0 - segBorder) * ringMask;
    if (activation > 0.01) {
        col += activeColor * glowMask;
    }

    float centerGlow = exp(-dist * 12.0) * activation;
    col += activeColor * centerGlow;

    col = clamp(col, 0.0, 1.0);
    // Alpha = coverage: empty background & segment gaps become transparent,
    // the ring stays opaque, and an active center glow remains.
    float centerAlpha = clamp(centerGlow, 0.0, 1.0);
    float coverage = clamp(ringMask * segBorder + glowMask + centerAlpha, 0.0, 1.0);
    fragColor = vec4(col, coverage);
}
