// Name: Ripple Pond

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime;
    float r = length(uv);

    float ripple1 = sin(r * 30.0 - t * 4.0) * exp(-r * 3.0);
    float ripple2 = sin(r * 20.0 - t * 3.0 + 1.0) * exp(-r * 4.0) * 0.6;
    float ripple3 = sin(r * 40.0 - t * 6.0 + 2.5) * exp(-r * 5.0) * 0.3;

    float wave = ripple1 + ripple2 + ripple3;

    vec3 deep = vec3(0.02, 0.08, 0.2);
    vec3 mid = vec3(0.05, 0.2, 0.4);
    vec3 bright = vec3(0.4, 0.7, 0.9);
    vec3 foam = vec3(0.8, 0.9, 1.0);

    vec3 col = mix(deep, mid, smoothstep(0.0, 0.4, r));
    col += bright * (0.5 + 0.5 * wave) * 0.3;
    col += foam * pow(max(wave, 0.0), 3.0) * 0.8;

    float caustic = sin(uv.x * 20.0 + wave * 5.0) * sin(uv.y * 20.0 + wave * 3.0);
    col += vec3(0.1, 0.2, 0.3) * caustic * 0.1;

    fragColor = vec4(col, 1.0);
}
