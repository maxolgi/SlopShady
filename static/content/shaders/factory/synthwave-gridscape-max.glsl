// Name: Synthwave Gridscape - Maximum Brightness Edition
// Synthwave Gridscape - Maximum Brightness Edition
// Ultra-bright retro aesthetic with maximum visibility

#define GRID_SCALE 1.3
#define LINE_WIDTH 0.028
#define SUN_COLOR vec3(1.0, 0.22, 0.08)
#define GRID_COLOR vec3(0.0, 0.95, 1.0)
#define FOG_COLOR vec3(0.2, 0.1, 0.45)

void main() {
    vec2 uv = (gl_FragCoord.xy / iResolution.xy) * 2.0 - 1.0;
    uv.x *= iResolution.x / iResolution.y;

    // Camera Setup with dynamic sway
    float eye_height = 0.5;
    float focal_length = 1.4;
    vec3 ray_origin = vec3(
        cos(iTime * 0.15) * 0.08, 
        eye_height + sin(iTime * 0.4) * 0.06, 
        4.0
    );
    vec3 ray_dir = normalize(vec3(uv, -focal_length));

    // Background: Maximum brightness retro gradient
    float time_shift = sin(iTime * 0.25) * 0.12;
    
    // MAXIMUM BRIGHTNESS sky colors - almost white!
    vec3 sky_top = vec3(0.85, 0.6, 0.95);
    vec3 sky_bottom = vec3(0.95, 0.75, 0.85);
    
    // Direct sky color without mixing - simpler approach
    vec3 color = mix(sky_bottom, sky_top, (uv.y + 1.0) * 0.5);

    // The Retro Sun - Perfectly balanced glow
    float sun_dist = length(vec2(uv.x, uv.y - 0.05));
    float sun_mask = smoothstep(0.42, 0.38, sun_dist);
    
    // Balanced sun glow with dynamic pulse
    float pulse = sin(iTime * 1.2) * 0.15 + 1.0;
    float glow_mask = exp(-sun_dist * 2.0 * pulse) * 0.4;
    color = mix(color, SUN_COLOR + glow_mask * SUN_COLOR * 0.7, sun_mask * 0.65);
    color = mix(color, SUN_COLOR * 1.3, glow_mask * 0.18);

    // Sun Stripes with enhanced animation
    if (sun_mask > 0.06) {
        float stripes = step(0.92, fract(uv.y * 18.0 - iTime * 0.12));
        color = mix(color, vec3(0.0), sun_mask * stripes * 0.45);
    }

    // Infinite Scrolling Grid with perfect depth
    float t = -ray_origin.y / ray_dir.y;

    if (t > 0.0) {
        vec3 hit_point = ray_origin + t * ray_dir;
        
        float scroll_speed = 2.2;
        float z_offset = iTime * scroll_speed;
        
        float x = hit_point.x;
        float z = hit_point.z + z_offset;

        float grid_x = abs(fract(x / GRID_SCALE - 0.5) - 0.5);
        float grid_z = abs(fract(z / GRID_SCALE - 0.5) - 0.5);
        
        // Enhanced line thickness with glow - BRIGHTER!
        float line = smoothstep(LINE_WIDTH, 0.0, grid_x) + smoothstep(LINE_WIDTH, 0.0, grid_z);
        vec3 grid_rgb = mix(vec3(0.4), GRID_COLOR, line * 1.0);
        
        // Strong glow to the lines - BRIGHTER!
        float line_glow = smoothstep(LINE_WIDTH * 2.8, 0.0, grid_x) + smoothstep(LINE_WIDTH * 2.8, 0.0, grid_z);
        grid_rgb += GRID_COLOR * line_glow * 0.5;

        // Fog/Distance Fade with improved depth - BRIGHTER!
        float fog_dist = smoothstep(1.2, 7.5, t);
        float fade_horizon = smoothstep(-3.0, 0.5, t); 
        float fade_vignette = smoothstep(4.0, 0.0, length(uv)); 
        
        vec3 final_grid_color = mix(FOG_COLOR, grid_rgb, fade_horizon * fade_vignette);
        color = mix(color, final_grid_color, fog_dist);
        
        // Re-apply the grid color over the fog for clarity at close range - BRIGHTER!
        color = mix(color, grid_rgb, fade_horizon * fade_vignette * (1.0 - fog_dist));
    }

    // VHS Scanlines with smooth animation
    float scanline = sin(gl_FragCoord.y * 0.35 + iTime * 0.25) * 0.018;
    color -= scanline;

    // Film grain effect - less visibility for brighter scene
    float noise = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
    color += (noise - 0.5) * 0.02;

    // Chromatic aberration on edges
    float edge = smoothstep(0.2, 0.55, length(uv));
    color.r -= edge * 0.015 * sin(iTime * 0.45);
    color.b += edge * 0.013 * cos(iTime * 0.4);

    // Color saturation boost for that retro look - LESS to preserve brightness
    float saturation = 1.2;
    vec3 avg = (color + vec3(1.0)) / 2.0;
    color = mix(avg, color, saturation) - avg;

    fragColor = vec4(color, 1.0);
}