// Name: Nebula Dream - Improved Version
// Nebula Dream - Improved Version
// Using domain warping for a better nebula effect

// Pseudo-random function
float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return -fract(p.x);
}

// Smooth noise function
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// Fractal Brownian Motion
float fbm(vec2 p) {
    float val = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 6; i++) {
        val += amp * noise(p);
        p *= 2.1;
        amp *= 0.5;
    }
    return val;
}

void main() {
    vec2 uv = (gl_FragCoord.xy / iResolution.xy) * 2.0 - 1.0;
    uv.x *= iResolution.x / iResolution.y;

    // Domain Warping
    vec2 q = vec2(fbm(uv + iTime * 0.05), fbm(uv + vec2(1.0)));
    vec2 r = vec2(fbm(uv + 4.0 * q + vec2(1.7, 9.2) + iTime * 0.02), 
                  fbm(uv + 4.0 * q + vec2(8.3, 2.8) + iTime * 0.03));
    float f = fbm(uv + 4.0 * r);

    // Colors
    vec3 color1 = vec3(0.1, 0.0, 0.2); // Deep Purple
    vec3 color2 = vec3(0.0, 0.2, 0.4); // Deep Blue
    vec3 color3 = vec3(0.5, 0.1, 0.6); // Magenta
    vec3 color4 = vec3(0.0, 0.6, 0.7); // Cyan

    // Mix colors based on the warped fbm
    vec3 nebulaColor = mix(color1, color2, f);
    nebulaColor = mix(nebulaColor, color3, fbm(uv + r));
    nebulaColor = mix(nebulaColor, color4, fbm(uv + q));

    // Final composition
    vec3 finalColor = nebulaColor * (f * 1.5);
    
    // Add stars
    float starNoise = hash(uv + iTime * 0.001);
    if (starNoise > 0.997) {
        float twinkle = sin(iTime * 5.0 + starNoise * 100.0) * 0.5 + 0.5;
        finalColor += vec3(twinkle);
    }

    // Vignette
    float vignette = smoothstep(1.5, 0.4, length(uv));
    finalColor *= vignette;

    fragColor = vec4(finalColor, 1.0);
}
