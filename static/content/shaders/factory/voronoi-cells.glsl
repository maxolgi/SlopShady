// Name: Voronoi Cells

vec2 hash2(vec2 p) {
    p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
    return fract(sin(p) * 43758.5453);
}

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    vec2 p = uv * 5.0;
    float t = iTime * 0.3;

    float minDist = 1.0;
    float secondDist = 1.0;
    vec2 nearestCell = vec2(0.0);

    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 neighbor = vec2(float(x), float(y));
            vec2 cell = floor(p) + neighbor;
            vec2 point = hash2(cell);
            point = 0.5 + 0.5 * sin(t + 6.2831 * point);
            float d = length(neighbor + point - fract(p));
            if (d < minDist) {
                secondDist = minDist;
                minDist = d;
                nearestCell = cell;
            } else if (d < secondDist) {
                secondDist = d;
            }
        }
    }

    vec3 col = vec3(0.0);
    float edge = secondDist - minDist;
    col += 0.4 + 0.6 * sin(hash2(nearestCell).x * 6.28 + vec3(0.0, 2.0, 4.0));
    col *= smoothstep(0.0, 0.05, edge);
    col += vec3(0.8, 0.9, 1.0) * (1.0 - smoothstep(0.0, 0.05, edge)) * 0.3;

    fragColor = vec4(col, 1.0);
}
