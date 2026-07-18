// Name: Synthwave Gridscape - Neon Dreams Edition
// Synthwave Gridscape - Neon Dreams Edition
// Ultra-retro aesthetic with enhanced saturation, bloom, and VHS effects

#define GRID_SCALE 1.2
#define LINE_WIDTH 0.035
#define SUN_COLOR vec3(1.0, 0.25, 0.05)
#define GRID_COLOR vec3(0.0, 0.95, 1.0)
#define FOG_COLOR vec3(0.05, 0.0, 0.25)

void main() {
    vec2 uv = (gl_FragCoord.xy / iResolution.xy) * 2.0 - 1.0;
    uv.x *= iResolution.x / iResolution.y;

    // Camera Setup with subtle camera sway
    float eye_height = 0.45;
    float focal_length = 1.3;
    vec3 ray_origin = vec3(sin(iTime * 0.2) * 0.1, eye_height + sin(iTime * 0.5) * 0.05, 3.5);
    vec3 ray_dir = normalize(vec3(uv, -focal_length));

    // Background: Deep retro gradient with color shift
    float time_shift = sin(iTime * 0.3) * 0.1;
    vec3 sky_top = mix(vec3(0.08, 0.02, 0.45 + time_shift), 
                       vec3(0.15, 0.05, 0.6 + time_shift), (uv.y + 1.0) * 0.5);
    vec3 sky_bottom = mix(vec3(0.2, 0.08, 0.4), 
                          vec3(0.25, 0.1, 0.35 + time_shift), (uv.y + 1.0) * 0.5);
    vec3 color = mix(sky_bottom, sky_top, (uv.y + 1.0) * 0.5);

    // The Retro Sun - Balanced glow with proper masking
    float sun_dist = length(vec2(uv.x, uv.y - 0.05));
    float sun_mask = smoothstep(0.38, 0.34, sun_dist);
    
    // Balanced sun glow - not too bright!
    float glow_mask = exp(-sun_dist * 2.2) * 0.35;
    color = mix(color, SUN_COLOR + glow_mask * SUN_COLOR * 0.6, sun_mask * 0.7);
    color = mix(color, SUN_COLOR * 1.2, glow_mask * 0.15);

    // Sun Stripes with smooth animation
    if (sun_mask > 0.08) {
        float stripes = step(0.93, fract(uv.y * 16.0 - iTime * 0.15));
        color = mix(color, vec3(0.0), sun_mask * stripes * 0.4);
    }

    // Infinite Scrolling Grid with enhanced depth
    float t = -ray_origin.y / ray_dir.y;

    if (t > 0.0) {
        vec3 hit_point = ray_origin + t * ray_dir;
        
        float scroll_speed = 1.8;
        float z_offset = iTime * scroll_speed;
        
        float x = hit_point.x;
        float z = hit_point.z + z_offset;

        float grid_x = abs(fract(x / GRID_SCALE - 0.5) - 0.5);
        float grid_z = abs(fract(z / GRID_SCALE - 0.5) - 0.5);
        
        // Enhanced line thickness with glow
        float line = smoothstep(LINE_WIDTH, 0.0, grid_x) + smoothstep(LINE_WIDTH, 0.0, grid_z);
        vec3 grid_rgb = mix(vec3(0.1), GRID_COLOR, line * 0.95);
        
        // Strong glow to the lines
        float line_glow = smoothstep(LINE_WIDTH * 2.5, 0.0, grid_x) + smoothstep(LINE_WIDTH * 2.5, 0.0, grid_z);
        grid_rgb += GRID_COLOR * line_glow * 0.35;

        // Fog/Distance Fade with better depth perception
        float fog_dist = smoothstep(1.5, 6.0, t);
        float fade_horizon = smoothstep(-2.5, 0.4, t); 
        float fade_vignette = smoothstep(3.5, 0.0, length(uv)); 
        
        vec3 final_grid_color = mix(FOG_COLOR, grid_rgb, fade_horizon * fade_vignette);
        color = mix(color, final_grid_color, fog_dist);
        
        // Re-apply the grid color over the fog for clarity at close range
        color = mix(color, grid_rgb, fade_horizon * fade_vignette * (1.0 - fog_dist));
    }

    // VHS Scanlines with subtle animation
    float scanline = sin(gl_FragCoord.y * 0.4 + iTime * 0.3) * 0.015;
    color -= scanline;

    // Film grain effect
    float noise = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
    color += (noise - 0.5) * 0.025;

    // Chromatic aberration on edges
    float edge = smoothstep(0.25, 0.6, length(uv));
    color.r -= edge * 0.012 * sin(iTime * 0.4);
    color.b += edge * 0.01 * cos(iTime * 0.35);

    // Color saturation boost for that retro look
    float saturation = 1.3;
    vec3 avg = (color + vec3(1.0)) / 2.0;
    color = mix(avg, color, saturation) - avg;

    fragColor = vec4(color, 1.0);
}