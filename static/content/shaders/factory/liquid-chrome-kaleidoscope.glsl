// Name: Liquid Chrome Kaleidoscope
// Liquid Chrome Kaleidoscope
// A vibrant, fluid-like symmetric visualization with chromatic aberration

#define SEGMENTS 6.0
#define SPEED 1.5

// Function to calculate the liquid pattern at a given position
vec3 get_liquid_color(vec2 pos, float time) {
    float l = 0.0;
    l += sin(pos.x * 4.0 + time * SPEED);
    l += sin(pos.y * 3.0 - time * 0.8 * SPEED);
    l += sin((pos.x + pos.y) * 2.0 + time * 1.2 * SPEED);
    l /= 3.0;
    
    vec3 col = vec3(0.05, 0.1, 0.2); // Deep base
    col += vec3(0.8, 0.5, 0.2) * (l + 0.5); // Golden/Orange flow
    col += vec3(0.2, 0.9, 0.7) * smoothstep(0.5, -0.5, l); // Cyan highlights
    return col;
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    vec2 p = (uv - 0.5) * 2.0;
    p.x *= iResolution.x / iResolution.y;

    // Kaleidoscope symmetry
    float angle = atan(p.y, p.x);
    float radius = length(p);
    float segmentAngle = 2.0 * 3.14159 / SEGMENTS;
    angle = mod(angle, segmentAngle) - segmentAngle * 0.5;
    
    // Rotate the entire space over time
    float rotation = iTime * 0.1 * SPEED;
    mat2 rotMat = mat2(cos(rotation), -sin(rotation), sin(rotation), cos(rotation));
    p = rotMat * p;

    // Reconstruct position in symmetric space
    vec2 k_p = vec2(cos(angle), sin(angle)) * radius;

    // Chromatic Aberration: sample RGB channels at different offsets
    float offset = 0.03 * sin(iTime * 0.5);
    
    vec3 colR = get_liquid_color(k_p + vec2(offset, 0.0), iTime);
    vec3 colG = get_liquid_color(k_p, iTime);
    vec3 colB = get_liquid_color(k_p - vec2(offset, 0.0), iTime);
    
    vec3 final_col = vec3(colR.r, colG.g, colB.b);

    // Add a vignette effect
    float vignette = smoothstep(1.5, 0.4, radius);
    final_col *= vignette;

    fragColor = vec4(final_col, 1.0);
}
