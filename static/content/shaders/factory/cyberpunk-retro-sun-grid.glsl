// Name: Cyberpunk Retro Sun & Grid
// Cyberpunk Retro Sun & Grid
// A retro-wave inspired shader with a neon grid and a glowing sun

#define GRID_SIZE 1.0
#define LINE_WIDTH 0.05
#define SUN_COLOR vec3(1.0, 0.4, 0.2)
#define GRID_COLOR vec3(0.0, 1.0, 0.8)

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    uv = (uv - 0.5) * 2.0;
    uv.x *= iResolution.x / iResolution.y;

    // Perspective projection for the "floor"
    float z = 1.0; // Distance to plane
    float perspective = 1.0 / (z - uv.y); 
    vec2 p = uv * perspective;
    
    // Define the floor plane in 3D space (x, y=0, z)
    float x = p.x;
    float z_plane = p.y; 

    // Background: Sky gradient
    vec3 sky_top = vec3(0.05, 0.0, 0.1);
    vec3 sky_bottom = vec3(0.2, 0.0, 0.3);
    vec3 color = mix(sky_bottom, sky_top, uv.y + 0.5);

    // The Retro Sun on the horizon
    float sun_radius = 0.4;
    float dist_to_sun = length(uv - vec2(0.0, 0.1));
    float sun = smoothstep(sun_radius, sun_radius - 0.05, dist_to_sun);
    color = mix(color, SUN_COLOR, sun * (0.8 + 0.2 * sin(iTime)));
    
    // Sun "stripes" effect (classic retro look)
    float stripes = step(0.02, fract(uv.y * 15.0 - iTime * 0.2));
    color *= mix(1.0, 0.5, sun * (1.0 - stripes));

    // The Grid Floor (only visible below the horizon)
    if (uv.y < 0.0) {
        // Only draw grid if we are "above" the plane in perspective
        float grid_x = floor(x / GRID_SIZE) / GRID_SIZE;
        float grid_z = floor(z_plane / GRID_SIZE) / GRID_SIZE;
        
        // Check for line proximity
        float line_x = abs(fract(x / GRID_SIZE) - 0.5);
        float line_z = abs(fract(z_plane / GRID_SIZE) - 0.5);
        float grid_lines = smoothstep(LINE_WIDTH, 0.0, line_x) + smoothstep(LINE_WIDTH, 0.0, line_z);
        
        vec3 grid_color = mix(vec3(0.1), GRID_COLOR, grid_lines);
        
        // Fade the grid into the distance/horizon
        float fade = smoothstep(-1.0, 0.5, z_plane);
        color = mix(color, grid_color, fade * (1.0 - abs(uv.y)));
    }

    // Scanlines and digital noise overlay
    float scanline = sin(uv.y * 400.0) * 0.05;
    color -= scanline;

    float noise = fract(sin(dot(uv, vec2(12.9898, 78.233))) * 43758.5453) * 0.03;
    color += noise;

    // Final brightness boost for neon effect
    color *= 1.2;

    fragColor = vec4(color, 1.0);
}
