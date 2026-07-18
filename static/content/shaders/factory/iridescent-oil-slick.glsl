// Name: Iridescent Oil Slick / Liquid Rainbow
// Iridescent Oil Slick / Liquid Rainbow
// (High saturation, smooth warping, and specular highlights)
vec3 palette(float t) {
    // Vibrant rainbow palette
    vec3 a = vec3(0.5, 0.5, 0.5);
    vec3 b = vec3(0.5, 0.5, 0.5);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.263, 0.416, 0.557);
    return a + b * cos(6.28318 * (c * t + d));
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime * 0.4;
    
    // Domain warping to create the swirling liquid effect
    vec2 p = uv;
    for(float i = 1.0; i < 5.0; i++) {
        p.x += 0.3 / i * sin(i * 3.0 * p.y + t + 0.5 * sin(t * 0.2));
        p.y += 0.3 / i * cos(i * 3.0 * p.x + t + 0.8 * cos(t * 0.3));
    }
    
    // Generate the iridescent color based on warped coordinates
    float color_index = length(p) * 2.5 + sin(p.x * 4.0 + t) * 0.5;
    vec3 col = palette(color_index);
    
    // Add "Specular" highlights to simulate the oily sheen
    // We use a very sharp smoothstep for light reflections
    float spec = smoothstep(0.1, 0.0, length(p - vec2(sin(t)*0.2, cos(t)*0.2)));
    col += spec * 0.4 * vec3(1.0, 1.0, 1.1); // Bright white/cyan highlight
    
    // Add a subtle dark shadow for depth
    col *= 0.8 + 0.2 * sin(p.x * 10.0 + t);
    
    // Final brightness boost and vignette
    col = mix(col, col * col, 0.2); // Slight contrast
    col *= 1.5 - length(uv) * 0.5;   // Soft edge vignette
    
    fragColor = vec4(col, 1.0);
}
