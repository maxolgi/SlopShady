// Name: Retrowave Horizon - Fixed Version
// Retrowave Horizon - Fixed Version
// A functional 3D perspective view of a neon grid receding into a sunset

#define GRID_SCALE 1.0
#define LINE_WIDTH 0.04
#define SUN_COLOR vec3(1.0, 0.4, 0.2)
#define GRID_COLOR vec3(0.0, 1.0, 0.8)

void main() {
    vec2 uv = (gl_FragCoord.xy / iResolution.xy) * 2.0 - 1.0;
    uv.x *= iResolution.x / iResolution.y;

    // Camera Setup
    float eye_height = 0.5;
    float focal_length = 1.0;
    vec3 ray_origin = vec3(0.0, eye_height, 2.0);
    vec3 ray_dir = normalize(vec3(uv, -focal_length));

    // Background: Sky Gradient
    vec3 sky_top = vec3(0.05, 0.0, 0.1);
    vec3 sky_bottom = vec3(0.2, 0.0, 0.3);
    vec3 color = mix(sky_bottom, sky_top, (uv.y + 1.0) * 0.5);

    // The Retro Sun
    float sun_dist = length(vec2(uv.x, uv.y - 0.1)); // Positioned slightly above horizon
    float sun_mask = smoothstep(0.4, 0.38, sun_dist);
    color = mix(color, SUN_COLOR, sun_mask * (0.8 + 0.2 * sin(iTime)));

    // Sun Stripes effect
    if (sun_mask > 0.1) {
        float stripes = step(0.95, fract(uv.y * 15.0 - iTime * 0.3));
        color = mix(color, vec3(0.0), sun_mask * stripes * 0.5);
    }

    // Ray-Plane Intersection (Plane at y = 0)
    float t = -ray_origin.y / ray_dir.y;

    if (t > 0.0) {
        vec3 hit_point = ray_origin + t * ray_dir;
        
        // Grid calculation in the world space of the plane
        float x = hit_point.x;
        float z = hit_point.z;

        float grid_x = abs(fract(x / GRID_SCALE - 0.5) - 0.5);
        float grid_z = abs(fract(z / GRID_SCALE - 0.5) - 0.5);
        float line = smoothstep(LINE_WIDTH, 0.0, grid_x) + smoothstep(LINE_WIDTH, 0.0, grid_z);

        vec3 grid_rgb = mix(vec3(0.1), GRID_COLOR, line);
        
        // Fade the grid into the horizon and distance
        float fade_horizon = smoothstep(-2.0, 0.5, t); // Fade based on depth/distance from camera
        float fade_vignette = smoothstep(3.0, 0.0, length(uv)); // Vignette edge
        
        color = mix(color, grid_rgb, fade_horizon * fade_vignette);
    }

    // Final Polish: Scanlines & Noise
    float scanline = sin(gl_FragCoord.y * 0.5) * 0.02;
    color -= scanline;

    float noise = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453) * 0.03;
    color += noise;

    fragColor = vec4(color, 1.0);
}
