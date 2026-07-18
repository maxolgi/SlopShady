// Name: Cyber-Wave Horizon - Enhanced Edition
// Cyber-Wave Horizon - Enhanced Edition
// Adding floating particles, dynamic sun pulses, volumetric atmosphere, and animated scanlines

#define GRID_SCALE 1.0
#define LINE_WIDTH 0.05
#define SUN_COLOR vec3(1.0, 0.3, 0.1)
#define GRID_COLOR vec3(0.0, 1.0, 0.9)
#define FOG_COLOR vec3(0.08, 0.02, 0.35)

void main() {
    vec2 uv = (gl_FragCoord.xy / iResolution.xy) * 2.0 - 1.0;
    uv.x *= iResolution.x / iResolution.y;

    // Camera Setup
    float eye_height = 0.4;
    float focal_length = 1.2;
    vec3 ray_origin = vec3(0.0, eye_height, 3.0);
    vec3 ray_dir = normalize(vec3(uv, -focal_length));

    // Background: Dynamic Sky Gradient with pulsing
    vec3 sky_top = mix(vec3(0.1, 0.02, 0.4), vec3(0.05, 0.0, 0.15), sin(iTime * 0.3) * 0.3 + 0.7);
    vec3 sky_bottom = mix(vec3(0.15, 0.03, 0.45), vec3(0.25, 0.05, 0.35), sin(iTime * 0.3) * 0.2 + 0.8);
    vec3 color = mix(sky_bottom, sky_top, (uv.y + 1.0) * 0.5);

    // The Retro Sun with Pulsing Glow effect
    float sun_dist = length(vec2(uv.x, uv.y - 0.05));
    float sun_mask = smoothstep(0.35, 0.32, sun_dist);
    
    // Dynamic pulse for the sun glow
    float pulse = sin(iTime * 1.5) * 0.2 + 1.0;
    float glow_mask = exp(-sun_dist * 2.5 * pulse) * 0.4;
    color = mix(color, SUN_COLOR + glow_mask * SUN_COLOR, sun_mask * (0.7 + 0.3 * sin(iTime)));
    color = mix(color, SUN_COLOR * 1.8, glow_mask * 0.25);

    // Sun Stripes with animation
    if (sun_mask > 0.1) {
        float stripes = step(0.94, fract(uv.y * 18.0 - iTime * 0.2));
        color = mix(color, vec3(0.0), sun_mask * stripes * 0.5);
    }

    // Floating Particles in the sky (starfield effect)
    float particle_count = 120.0;
    for (int i = 0; i < int(particle_count); i++) {
        vec3 p_pos = sin(vec3(i, iTime * 0.5, 0.0)) * 2.0 + vec3(0.0, 1.5, -4.0);
        float p_size = abs(sin(dot(uv, vec2(float(i), 2.0))) * 0.05) * 0.8;
        if (length(p_pos.xy) > 0.5 && length(p_pos.xy) < 1.2) {
            color += mix(vec3(0.8, 0.9, 1.0), vec3(0.3, 0.6, 1.0), sin(iTime * 2.0 + float(i)) * 0.5) * p_size;
        }
    }

    // Ray-Plane Intersection (Plane at y = 0)
    float t = -ray_origin.y / ray_dir.y;

    if (t > 0.0) {
        vec3 hit_point = ray_origin + t * ray_dir;
        
        // Infinite Scrolling Grid with depth distortion
        float scroll_speed = 2.0;
        float z_offset = iTime * scroll_speed;
        
        float x = hit_point.x;
        float z = hit_point.z + z_offset;

        float grid_x = abs(fract(x / GRID_SCALE - 0.5) - 0.5);
        float grid_z = abs(fract(z / GRID_SCALE - 0.5) - 0.5);
        
        // Enhanced line thickness with glow
        float line = smoothstep(LINE_WIDTH, 0.0, grid_x) + smoothstep(LINE_WIDTH, 0.0, grid_z);
        vec3 grid_rgb = mix(vec3(0.15), GRID_COLOR, line);
        
        // Add a strong glow to the lines
        float line_glow = smoothstep(LINE_WIDTH * 2.0, 0.0, grid_x) + smoothstep(LINE_WIDTH * 2.0, 0.0, grid_z);
        grid_rgb += GRID_COLOR * line_glow * 0.5;

        // Fog/Distance Fade with improved depth
        float fog_dist = smoothstep(1.0, 8.0, t);
        float fade_horizon = smoothstep(-2.0, 0.3, t); 
        float fade_vignette = smoothstep(2.5, 0.0, length(uv)); 
        
        vec3 final_grid_color = mix(FOG_COLOR, grid_rgb, fade_horizon * fade_vignette);
        color = mix(color, final_grid_color, fog_dist);
        
        // Re-apply the grid color over the fog for clarity at close range
        color = mix(color, grid_rgb, fade_horizon * fade_vignette * (1.0 - fog_dist));
    }

    // Animated Scanlines with varying opacity
    float scanline = sin(gl_FragCoord.y * 0.5 + iTime) * 0.03;
    color -= scanline;

    // Fractal noise for texture
    float noise1 = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453);
    float noise2 = fract(sin(dot(uv, vec2(78.233, 12.9898))) * 43758.5453);
    float combined_noise = (noise1 + noise2) * 0.015;
    color += combined_noise;

    // Chromatic aberration effect on edges
    float edge = smoothstep(0.3, 0.5, length(uv));
    color.r -= edge * 0.02 * sin(iTime * 0.5);
    color.b += edge * 0.015 * cos(iTime * 0.4);

    fragColor = vec4(color, 1.0);
}