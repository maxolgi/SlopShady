// Name: Starfield

float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime * 0.3;

    vec3 col = vec3(0.01, 0.01, 0.03);

    for (int layer = 0; layer < 3; layer++) {
        float fl = float(layer);
        float speed = 0.5 + fl * 0.3;
        float scale = 50.0 + fl * 30.0;

        vec2 p = uv * scale;
        p.y += t * speed * scale * 0.1;

        vec2 cell = floor(p);
        vec2 local = fract(p);

        for (int y = -1; y <= 1; y++) {
            for (int x = -1; x <= 1; x++) {
                vec2 neighbor = vec2(float(x), float(y));
                vec2 cellId = cell + neighbor;
                float h = hash(cellId + fl * 100.0);
                if (h > 0.85) {
                    vec2 starPos = vec2(hash(cellId + 0.1), hash(cellId + 0.2));
                    vec2 offset = local - neighbor - starPos;
                    float dist = length(offset);
                    float brightness = (1.0 - fl * 0.25) * hash(cellId + 0.3);
                    float twinkle = 0.5 + 0.5 * sin(t * 4.0 + h * 100.0);
                    float star = 0.001 / (dist * dist + 0.0001) * brightness * twinkle;
                    vec3 starCol = mix(vec3(0.8, 0.9, 1.0), vec3(1.0, 0.8, 0.6), hash(cellId + 0.4));
                    col += starCol * star;
                }
            }
        }
    }

    fragColor = vec4(col, 1.0);
}
