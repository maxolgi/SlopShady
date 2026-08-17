/**
 * Configuration and Constants
 * Centralized configuration for the SlopShady application
 */

// =============== CONSTANTS ===============
export const SHADER_BUILTINS = new Set([
    'iTime', 'iResolution', 'iMouse', 'iFrame', 'iTimeDelta', 'iFrameRate', 'iSampleRate', 'iDate',
    'gl_FragCoord', 'gl_FragColor', 'pi', 'void', 'float', 'int', 'return', 'for', 'if', 'else', 
    'while', 'break', 'continue', 'in', 'out', 'inout', 'uniform', 'varying', 'attribute', 'const', 
    'struct', 'precision', 'highp', 'mediump', 'lowp', 'abs', 'sin', 'cos', 'tan', 'pow', 'exp', 
    'log', 'sqrt', 'length', 'dot', 'normalize', 'mix', 'smoothstep', 'clamp', 'min', 'max', 
    'floor', 'ceil', 'fract', 'mod', 'reflect', 'refract', 'cross', 'vec2', 'vec3', 'vec4', 
    'mat2', 'mat3', 'mat4'
]);

// =============== VERTEX SHADERS ===============
export const VERTEX_SHADER = `#version 300 es
in vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`;

export const COMPOSITE_VS = `#version 300 es
in vec2 position;
out vec2 vUv;
void main() {
    vUv = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
}`;

export const COMPOSITE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D u_base;
uniform sampler2D u_layer;
uniform float u_opacity;
uniform int u_blendMode;
uniform float u_posX;
uniform float u_posY;
uniform float u_scale;
uniform float u_rotation;
uniform float u_brightness;
uniform float u_amount;
uniform float u_radius;
uniform float u_stretch;
uniform float u_maskPosX;
uniform float u_maskPosY;
uniform float u_maskSoftness;
void main() {
    vec4 base = texture(u_base, vUv);
    vec2 layerUv = vUv;
    layerUv -= vec2(u_posX, u_posY);
    float layerS = max(u_scale, 0.001);
    layerUv = (layerUv - 0.5) / layerS + 0.5;
    float stretchX = u_stretch > 0.0 ? 1.0 + u_stretch : 1.0;
    float stretchY = u_stretch < 0.0 ? 1.0 - u_stretch : 1.0;
    layerUv = (layerUv - 0.5) / vec2(stretchX, stretchY) + 0.5;
    float layerAngle = u_rotation;
    float layerCosA = cos(layerAngle);
    float layerSinA = sin(layerAngle);
    layerUv = mat2(layerCosA, -layerSinA, layerSinA, layerCosA) * (layerUv - 0.5) + 0.5;
    if (layerUv.x < 0.0 || layerUv.x > 1.0 || layerUv.y < 0.0 || layerUv.y > 1.0) {
        fragColor = base;
        return;
    }
    vec4 layer = texture(u_layer, layerUv);
    layer.rgb *= u_brightness * u_amount;
    ivec2 texSize = textureSize(u_layer, 0);
    float aspect = float(texSize.x) / float(texSize.y);
    vec2 centered = layerUv - (0.5 + vec2(u_maskPosX, u_maskPosY));
    centered.x *= aspect;
    float dist = length(centered);
    float maskRadius = u_radius * sqrt(aspect * aspect + 1.0);
    float feather = max(u_maskSoftness, 0.0001);
    layer.a *= smoothstep(maskRadius + feather, maskRadius - feather, dist);
    float alpha = u_opacity * layer.a;
    vec4 result;
    if (u_blendMode == 0) {
        result = mix(base, layer, alpha);
    } else if (u_blendMode == 1) {
        result = base + layer * alpha;
    } else if (u_blendMode == 2) {
        result = base * mix(vec4(1.0), layer, alpha);
    } else if (u_blendMode == 3) {
        vec4 screened = vec4(1.0) - (vec4(1.0) - base) * (vec4(1.0) - layer);
        result = mix(base, screened, alpha);
    } else if (u_blendMode == 4) {
        vec4 overlaid;
        overlaid.r = base.r < 0.5 ? 2.0 * base.r * layer.r : 1.0 - 2.0 * (1.0 - base.r) * (1.0 - layer.r);
        overlaid.g = base.g < 0.5 ? 2.0 * base.g * layer.g : 1.0 - 2.0 * (1.0 - base.g) * (1.0 - layer.g);
        overlaid.b = base.b < 0.5 ? 2.0 * base.b * layer.b : 1.0 - 2.0 * (1.0 - base.b) * (1.0 - layer.b);
        overlaid.a = layer.a;
        result = mix(base, overlaid, alpha);
    } else if (u_blendMode == 5) {
        result = mix(base, max(base, layer), alpha);
    } else if (u_blendMode == 6) {
        result = mix(base, min(base, layer), alpha);
    } else if (u_blendMode == 7) {
        result = mix(base, base - layer, alpha);
    } else if (u_blendMode == 8) {
        result = mix(base, abs(base - layer), alpha);
    } else {
        result = mix(base, layer, alpha);
    }
    fragColor = clamp(result, 0.0, 1.0);
}`;

export const BACKGROUND_FS = `#version 300 es
precision highp float;
out vec4 fragColor;
uniform vec3 u_bgColor;
void main() {
    fragColor = vec4(u_bgColor, 1.0);
}`;

export const PASSTHROUGH_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D u_texture;
void main() {
    fragColor = texture(u_texture, vUv);
}`;

// =============== VISUAL BRAIN SHADERS ===============
export const VB_FEATURE_VS = `#version 300 es
in vec2 position;
out vec2 vUv;
void main() {
    vUv = position * 0.5 + 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
}`;

export const VB_FEATURE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
layout(location = 0) out vec4 fragColor0;
layout(location = 1) out vec4 fragColor1;
uniform sampler2D uInput;
uniform vec2 uResolution;
uniform float uBlockSize;
uniform vec2 uGridSize;

void main() {
    ivec2 cell = ivec2(gl_FragCoord.xy);
    vec2 blockOrigin = vec2(cell) * uBlockSize;
    float bs = uBlockSize;
    float step = max(1.0, floor(bs / 6.0));
    vec3 meanColor = vec3(0.0);
    float meanLum = 0.0;
    float count = 0.0;
    for (float dy = 0.0; dy < bs; dy += step) {
        for (float dx = 0.0; dx < bs; dx += step) {
            vec2 px = (blockOrigin + vec2(dx, dy) + 0.5) / uResolution;
            vec3 col = texture(uInput, px).rgb;
            meanColor += col;
            meanLum += dot(col, vec3(0.299, 0.587, 0.114));
            count += 1.0;
        }
    }
    meanColor /= count;
    meanLum /= count;
    float variance = 0.0;
    float edgeH = 0.0;
    float edgeV = 0.0;
    float edgeCount = 0.0;
    for (float dy = 0.0; dy < bs; dy += step) {
        for (float dx = 0.0; dx < bs; dx += step) {
            vec2 px = (blockOrigin + vec2(dx, dy) + 0.5) / uResolution;
            vec3 col = texture(uInput, px).rgb;
            float lum = dot(col, vec3(0.299, 0.587, 0.114));
            variance += (lum - meanLum) * (lum - meanLum);
            if (dx + step < bs) {
                vec2 px2 = (blockOrigin + vec2(dx + step, dy) + 0.5) / uResolution;
                float lum2 = dot(texture(uInput, px2).rgb, vec3(0.299, 0.587, 0.114));
                edgeH += abs(lum2 - lum);
            }
            if (dy + step < bs) {
                vec2 px3 = (blockOrigin + vec2(dx, dy + step) + 0.5) / uResolution;
                float lum3 = dot(texture(uInput, px3).rgb, vec3(0.299, 0.587, 0.114));
                edgeV += abs(lum3 - lum);
            }
            edgeCount += 1.0;
        }
    }
    variance /= count;
    edgeH /= max(edgeCount, 1.0);
    edgeV /= max(edgeCount, 1.0);
    fragColor0 = vec4(meanColor, min(variance / 3000.0, 1.0));
    fragColor1 = vec4(min(edgeH / 60.0, 1.0), min(edgeV / 60.0, 1.0), meanLum, 0.0);
}`;

export const VB_MATCH_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uInputFeatures0;
uniform sampler2D uInputFeatures1;
uniform sampler2D uCorpusFeatures0;
uniform sampler2D uCorpusFeatures1;
uniform int uCorpusCount;
uniform float uColorWeight;

void main() {
    ivec2 cell = ivec2(gl_FragCoord.xy);
    vec4 inF0 = texelFetch(uInputFeatures0, cell, 0);
    vec4 inF1 = texelFetch(uInputFeatures1, cell, 0);
    float bestDist = 999999.0;
    int bestIdx = 0;
    for (int c = 0; c < 4096; c++) {
        if (c >= uCorpusCount) break;
        vec4 cF0 = texelFetch(uCorpusFeatures0, ivec2(c, 0), 0);
        vec4 cF1 = texelFetch(uCorpusFeatures1, ivec2(c, 0), 0);
        vec3 dColor = inF0.rgb - cF0.rgb;
        float dVar = inF0.a - cF0.a;
        float dEdgeH = inF1.r - cF1.r;
        float dEdgeV = inF1.g - cF1.g;
        float dist = uColorWeight * dot(dColor, dColor) + dVar * dVar + 0.5 * (dEdgeH * dEdgeH + dEdgeV * dEdgeV);
        if (dist < bestDist) {
            bestDist = dist;
            bestIdx = c;
        }
    }
    float r = float(bestIdx % 256) / 255.0;
    float g = float(bestIdx / 256) / 255.0;
    fragColor = vec4(r, g, clamp(sqrt(bestDist), 0.0, 1.0), 1.0);
}`;

export const VB_RENDER_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uVideo;
uniform sampler2D uAtlas;
uniform sampler2D uMatchMap;
uniform sampler2D uAudioTex;
uniform vec2 uResolution;
uniform vec2 uGridSize;
uniform float uBlockSize;
uniform vec2 uAtlasGridSize;
uniform float uTime;
uniform float uBlend;
uniform float uGrid;
uniform float uScanline;
uniform float uGlitch;
uniform float uAudioReact;
uniform float uCorpusCount;
uniform float uBrightness;

int decodeIndex(vec4 d) {
    return int(d.r * 255.0 + 0.5) + int(d.g * 255.0 + 0.5) * 256;
}

void main() {
    vec2 uv = vUv;
    vec2 pixel = uv * uResolution;
    vec4 srcColor = texture(uVideo, uv);
    if (uCorpusCount < 1.0) {
        fragColor = vec4(srcColor.rgb * uBrightness, 1.0);
        return;
    }
    vec2 cell = floor(pixel / uBlockSize);
    vec2 withinCell = fract(pixel / uBlockSize);
    if (cell.x >= uGridSize.x || cell.y >= uGridSize.y || cell.x < 0.0 || cell.y < 0.0) {
        fragColor = vec4(srcColor.rgb * uBrightness, 1.0);
        return;
    }
    vec2 cellUv = (cell + 0.5) / uGridSize;
    vec4 matchData = texture(uMatchMap, cellUv);
    int matchIdx = decodeIndex(matchData);
    float matchDist = matchData.b;
    if (matchIdx >= int(uCorpusCount) || matchIdx < 0) {
        fragColor = vec4(srcColor.rgb * uBrightness, 1.0);
        return;
    }
    float atlasX = float(matchIdx % int(uAtlasGridSize.x));
    float atlasY = float(matchIdx / int(uAtlasGridSize.x));
    vec2 atlasUv = (vec2(atlasX, atlasY) + withinCell) / uAtlasGridSize;
    vec4 brainColor = texture(uAtlas, atlasUv);
    vec4 color = mix(srcColor, brainColor, uBlend);
    float poorMatch = smoothstep(0.06, 0.5, matchDist);
    if (uGlitch > 0.0) {
        float gs = poorMatch * uGlitch;
        float ab = gs * 0.01;
        vec2 shift = vec2(
            sin(uTime * 17.3 + cell.x * 5.7 + cell.y * 3.1),
            cos(uTime * 11.9 + cell.y * 9.3 + cell.x * 4.7)
        ) * gs * 0.02;
        float sr = texture(uVideo, uv + shift + vec2(ab, 0.0)).r;
        float sg = texture(uVideo, uv + shift).g;
        float sb = texture(uVideo, uv + shift - vec2(ab, 0.0)).b;
        vec3 glitchSrc = vec3(sr, sg, sb);
        color.rgb = mix(color.rgb, glitchSrc, gs * 0.7);
        float dice = fract(sin(dot(cell, vec2(12.9898, 78.233)) + uTime * 0.7) * 43758.5453);
        if (gs > 0.35 && dice > 0.82) {
            float dx = (dice - 0.82) * 30.0 * gs;
            vec2 dCell = cell + vec2(dx, 0.0);
            vec2 dCellUv = (dCell + 0.5) / uGridSize;
            vec4 dMatch = texture(uMatchMap, dCellUv);
            int dIdx = decodeIndex(dMatch);
            float dAx = float(dIdx % int(uAtlasGridSize.x));
            float dAy = float(dIdx / int(uAtlasGridSize.x));
            vec2 dAtlasUv = (vec2(dAx, dAy) + withinCell) / uAtlasGridSize;
            color = texture(uAtlas, dAtlasUv);
        }
    }
    if (uAudioReact > 0.01) {
        float freq = cell.x / uGridSize.x;
        float amp = texture(uAudioTex, vec2(freq, 0.5)).r;
        color.rgb += amp * uAudioReact * 0.35 * vec3(0.15, 1.0, 0.55);
        vec2 centered = withinCell - 0.5;
        float sc = 1.0 + amp * uAudioReact * 0.12;
        vec2 scaledUv = centered / sc + 0.5;
        if (scaledUv.x >= 0.0 && scaledUv.x <= 1.0 && scaledUv.y >= 0.0 && scaledUv.y <= 1.0) {
            vec2 sUv = (vec2(atlasX, atlasY) + scaledUv) / uAtlasGridSize;
            vec4 sC = texture(uAtlas, sUv);
            color.rgb = mix(color.rgb, sC.rgb, amp * uAudioReact * 0.3);
        }
    }
    if (uGrid > 0.5) {
        vec2 edgeDist = min(withinCell, 1.0 - withinCell);
        float edge = 1.0 - smoothstep(0.0, 0.07, min(edgeDist.x, edgeDist.y));
        vec3 gridCol = vec3(0.0, 1.0, 0.64) * (0.25 + 0.1 * sin(uTime * 0.6 + cell.x * 0.4 + cell.y * 0.6));
        color.rgb = mix(color.rgb, gridCol, edge * 0.45);
    }
    if (uScanline > 0.5) {
        float scanY = fract(uTime * 0.2) * uGridSize.y;
        float scanDist = abs(cell.y - scanY);
        float scan = smoothstep(3.5, 0.0, scanDist);
        color.rgb += vec3(0.0, 0.6, 0.4) * scan * 0.1;
        color.rgb -= sin(pixel.y * 1.6) * 0.015 + 0.015;
    }
    float vig = 1.0 - 0.35 * pow(length((uv - 0.5) * vec2(1.4, 1.6)), 2.2);
    color.rgb *= vig;
    color.rgb *= uBrightness;
    fragColor = vec4(color.rgb, 1.0);
}`;

export const VB_BLIT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D uSrc;
uniform vec2 uSrcOffset;
uniform vec2 uSrcScale;
uniform vec2 uDstOffset;
uniform vec2 uDstScale;
uniform vec2 uAtlasGridSize;

void main() {
    vec2 dstUv = vUv;
    vec2 srcUv = (dstUv - uDstOffset) / uDstScale;
    if (srcUv.x < 0.0 || srcUv.x > 1.0 || srcUv.y < 0.0 || srcUv.y > 1.0) {
        discard;
    }
    fragColor = texture(uSrc, srcUv);
}`;

// =============== IMAGE RENDERING SHADER ===============
export const IMAGE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D u_image;
uniform vec2 u_imageRes;
uniform vec2 u_canvasRes;
uniform int u_fitMode; // 0: cover, 1: contain, 2: stretch
uniform float u_flipY; // 0.0: normal, 1.0: flip Y

void main() {
    vec2 uv = vUv;
    
    // Flip Y if needed (for webcam)
    if (u_flipY > 0.5) {
        uv.y = 1.0 - uv.y;
    }
    
    if (u_fitMode == 0) {
        // Cover: fill canvas, crop excess
        float imageAspect = u_imageRes.x / u_imageRes.y;
        float canvasAspect = u_canvasRes.x / u_canvasRes.y;
        vec2 scale = vec2(1.0);
        if (imageAspect > canvasAspect) {
            scale.x = canvasAspect / imageAspect;
        } else {
            scale.y = imageAspect / canvasAspect;
        }
        uv = (uv - 0.5) / scale + 0.5;
    } else if (u_fitMode == 1) {
        // Contain: fit within canvas, letterbox
        float imageAspect = u_imageRes.x / u_imageRes.y;
        float canvasAspect = u_canvasRes.x / u_canvasRes.y;
        vec2 scale = vec2(1.0);
        if (imageAspect > canvasAspect) {
            scale.y = imageAspect / canvasAspect;
        } else {
            scale.x = canvasAspect / imageAspect;
        }
        uv = (uv - 0.5) * scale + 0.5;
    }
    // Stretch: use uv as-is
    
    // Clamp UVs to prevent sampling outside texture
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    } else {
        fragColor = texture(u_image, uv);
    }
}`;

// =============== FEEDBACK SHADER ===============
export const FEEDBACK_FS = `#version 300 es
precision highp float;
uniform sampler2D u_currentFrame;
uniform sampler2D u_lastFrame;
uniform float u_feedbackAmount;
uniform float u_decay;
uniform float u_zoom;
uniform float u_rotate;
uniform vec2 u_offset;
uniform vec2 iResolution;
uniform float u_saturation; // 0=desaturated, 1=normal, 2=oversaturated
uniform float u_brightness; // 0=black, 1=normal, 2=overbright
uniform int u_blendMode; // 0=mix, 1=add, 2=multiply, 3=screen, 4=overlay, 5=lighten, 6=darken, 7=subtract, 8=difference
in vec2 vUv;
out vec4 fragColor;

vec3 adjustSaturation(vec3 color, float sat) {
    float grey = dot(color, vec3(0.2126, 0.7152, 0.0722));
    return mix(vec3(grey), color, sat);
}

void main() {
    vec2 uv = vUv;
    vec2 centered = uv - 0.5;
    centered /= u_zoom;
    float angle = u_rotate;
    mat2 rot = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
    centered = rot * centered;
    centered += u_offset;
    vec2 feedbackUv = centered + 0.5;
    vec4 current = texture(u_currentFrame, uv);
    vec4 last = texture(u_lastFrame, feedbackUv);
    last *= u_decay;

    vec3 fbColor = last.rgb * u_brightness;
    fbColor = adjustSaturation(fbColor, u_saturation);

    vec3 blended;
    if (u_blendMode == 0) {
        blended = mix(current.rgb, fbColor, u_feedbackAmount);
    } else if (u_blendMode == 1) {
        blended = current.rgb + fbColor * u_feedbackAmount;
    } else if (u_blendMode == 2) {
        blended = current.rgb * mix(vec3(1.0), fbColor, u_feedbackAmount);
    } else if (u_blendMode == 3) {
        vec3 screened = vec3(1.0) - (vec3(1.0) - current.rgb) * (vec3(1.0) - fbColor);
        blended = mix(current.rgb, screened, u_feedbackAmount);
    } else if (u_blendMode == 4) {
        vec3 overlaid;
        overlaid.r = current.r < 0.5 ? 2.0 * current.r * fbColor.r : 1.0 - 2.0 * (1.0 - current.r) * (1.0 - fbColor.r);
        overlaid.g = current.g < 0.5 ? 2.0 * current.g * fbColor.g : 1.0 - 2.0 * (1.0 - current.g) * (1.0 - fbColor.g);
        overlaid.b = current.b < 0.5 ? 2.0 * current.b * fbColor.b : 1.0 - 2.0 * (1.0 - current.b) * (1.0 - fbColor.b);
        blended = mix(current.rgb, overlaid, u_feedbackAmount);
    } else if (u_blendMode == 5) {
        blended = max(current.rgb, fbColor * u_feedbackAmount);
    } else if (u_blendMode == 6) {
        blended = min(current.rgb, fbColor * u_feedbackAmount);
    } else if (u_blendMode == 7) {
        blended = current.rgb - fbColor * u_feedbackAmount;
    } else if (u_blendMode == 8) {
        blended = abs(current.rgb - fbColor * u_feedbackAmount);
    } else {
        blended = mix(current.rgb, fbColor, u_feedbackAmount);
    }

    fragColor = vec4(clamp(blended, 0.0, 2.0), current.a);
}`;

// =============== MAX VOICES ===============
export const MAX_VOICES = 4;

// =============== VOICE-AWARE SHADER TEMPLATE ===============
// Strategy: Instead of fragile regex transforms on user code, we use
// GLSL preprocessor macros to redirect the user's main() and fragColor.
// The user's code is included verbatim, and a wrapper main() is appended
// that calls the user's main() inside a helper that captures output.

// Layer parameter uniforms — always injected, even when voice mode is off
export const LAYER_UNIFORMS_DECL = `
uniform float u_brightness;
uniform float u_speed;
uniform float u_posX;
uniform float u_posY;
uniform float u_scale;
uniform float u_radius;
uniform float u_amount;
uniform float u_rotation;
uniform float u_stretch;
uniform float u_maskPosX;
uniform float u_maskPosY;
uniform float u_maskSoftness;
`;

export const VOICE_UNIFORMS_DECL = `
uniform float u_voiceActive[${MAX_VOICES}];
uniform float u_voiceNote[${MAX_VOICES}];
uniform float u_voiceVelocity[${MAX_VOICES}];
uniform float u_voiceEG[${MAX_VOICES}];
uniform float u_voicePosX[${MAX_VOICES}];
uniform float u_voicePosY[${MAX_VOICES}];
uniform float u_voiceScale[${MAX_VOICES}];
uniform float u_voiceRotation[${MAX_VOICES}];
uniform float u_voiceUsePos[${MAX_VOICES}];
uniform float u_voiceUseScale[${MAX_VOICES}];
uniform float u_voiceUseRot[${MAX_VOICES}];
uniform float u_pitchBend;
uniform float u_channelPressure;
uniform float u_kbdNote;
uniform float u_eg0;
uniform float u_eg1;
uniform float u_eg2;
uniform float u_eg3;
`;

// Set of uniform names that correspond to layer params (for routing modulation output)
export const LAYER_PARAM_UNIFORMS = new Set([
  'u_opacity', 'u_brightness', 'u_speed', 'u_posX', 'u_posY', 'u_scale',
  'u_radius', 'u_amount', 'u_rotation', 'u_stretch', 'u_maskPosX',
  'u_maskPosY', 'u_maskSoftness'
]);

// This wrapper is appended AFTER the user's code.
// It renames user's main() to _userMain() via #define, captures the fragColor output,
// then iterates over voices, transforming UVs and accumulating results.
export const VOICE_SHADER_WRAPPER = `
#undef main
#undef fragColor
#undef gl_FragCoord
out vec4 fragColor;

void _voiceRenderOnce(vec2 voiceUv) {
    _voiceOutColor = vec4(0.0);
    _voiceFragUv = voiceUv;
    _userMain();
}

void main() {
    vec2 screenUv = gl_FragCoord.xy / iResolution.xy;
    vec3 color = vec3(0.0);
    float alpha = 0.0;
    int activeCount = 0;

    for (int i = 0; i < ${MAX_VOICES}; i++) {
        if (u_voiceActive[i] > 0.5) activeCount++;
    }

    if (activeCount > 0) {
        float weight = 1.0 / float(activeCount);
        for (int i = 0; i < ${MAX_VOICES}; i++) {
            if (u_voiceActive[i] > 0.5) {
                vec2 voiceUv = screenUv;

                if (u_voiceUsePos[i] > 0.5) {
                    voiceUv -= vec2(u_voicePosX[i], u_voicePosY[i]);
                }

                if (u_voiceUseScale[i] > 0.5) {
                    float s = max(u_voiceScale[i], 0.001);
                    voiceUv = (voiceUv - 0.5) / s + 0.5;
                }

                if (u_voiceUseRot[i] > 0.5) {
                    float angle = u_voiceRotation[i];
                    float cosA = cos(angle);
                    float sinA = sin(angle);
                    voiceUv = mat2(cosA, -sinA, sinA, cosA) * (voiceUv - 0.5) + 0.5;
                }

                _voiceRenderOnce(voiceUv);

                color += _voiceOutColor.rgb * weight;
                alpha += _voiceOutColor.a * weight;
            }
        }
    } else {
        _voiceRenderOnce(screenUv);
        color = _voiceOutColor.rgb;
        alpha = _voiceOutColor.a;
    }

    fragColor = vec4(color, clamp(alpha, 0.0, 1.0));
}
`;

// =============== BLEND MODES ===============
export const BLEND_MODES = ['normal', 'add', 'multiply', 'screen', 'overlay', 'lighten', 'darken', 'subtract', 'difference'];

export const BLEND_MODE_OPTIONS = [
    { value: 'normal', label: 'Normal' },
    { value: 'add', label: 'Add' },
    { value: 'multiply', label: 'Multiply' },
    { value: 'screen', label: 'Screen' },
    { value: 'overlay', label: 'Overlay' },
    { value: 'lighten', label: 'Lighten' },
    { value: 'darken', label: 'Darken' },
    { value: 'subtract', label: 'Subtract' },
    { value: 'difference', label: 'Difference' }
];

// =============== DIAL KEY MAP ===============
export const DIAL_KEY_MAP = ['q','w','e','r','t','y','u','i','o','p','a','s','d','f','g','h','j','k','l','z','x','c','v','b','n','m'];

// =============== SETTINGS KEYS ===============
export const SETTINGS_KEYS = {
    apiUrl: 'slopshady_apiUrl',
    bearerKey: 'slopshady_bearerKey',
    modelNameImage: 'slopshady_modelNameImage',
    modelNameText: 'slopshady_modelNameText',
    captureResolution: 'slopshady_captureResolution',
    captureFormat: 'slopshady_captureFormat',
    captureQuality: 'slopshady_captureQuality',
    liveTuningMaxIterations: 'slopshady_liveTuningMaxIterations',
    syncEnabled: 'slopshady_syncEnabled',
    tooltipsEnabled: 'slopshady_tooltipsEnabled',
    fboFormat: 'slopshady_fboFormat',
    resolutionScale: 'slopshady_resolutionScale',
    cameraDeviceId: 'slopshady_cameraDeviceId',
    screenMonitorIndex: 'slopshady_screenMonitorIndex',
    midiDeviceId: 'slopshady_midiDeviceId',
};

// =============== MODULATION CURVES ===============
export const MODULATION_CURVES = {
    linear: x => x,
    exponential: x => x * x,
    exp: x => x * x,
    logarithmic: x => Math.log10(x * 9 + 1),
    log: x => Math.log10(x * 9 + 1),
    sine: x => Math.sin(x * Math.PI / 2),
    smooth: x => x * x * (3 - 2 * x)
};

// =============== MODULATION SOURCES ===============
export const MODULATION_SOURCES = [
    'note', 'velocity', 'cc', 'osc', 'aftertouch', 'pitchbend',
    'kbd', 'eg0', 'eg1', 'eg2', 'eg3', 'lfo1', 'lfo2', 'lfo3', 'lfo4',
    'audio_peak', 'audio_band_low', 'audio_band_mid', 'audio_band_high',
    'macro1', 'macro2', 'macro3', 'macro4', 'macro5', 'macro6', 'macro7', 'macro8'
];

// =============== DEFAULT OSC ADDRESSES ===============
export const DEFAULT_OSC_ADDRESSES = {
    'u_opacity': '/ch/1',
    'u_brightness': '/ch/2',
    'u_speed': '/ch/3',
    'u_posX': '/ch/4',
    'u_posY': '/ch/5',
    'u_scale': '/ch/6',
    'u_radius': '/ch/7',
    'u_amount': '/ch/8',
    'u_rotation': '/ch/9',
    'u_stretch': '/ch/10',
    'u_maskPosX': '/ch/11',
    'u_maskPosY': '/ch/12',
    'u_maskSoftness': '/ch/13',
};

// =============== DEFAULT MODULATION ENTRY ===============
export const DEFAULT_MODULATION_ENTRY = {
    id: '',
    source: 'cc',
    sourceConfig: {},
    destination: '',
    amount: 1.0,
    curve: 'linear',
    enabled: false
};

// =============== LFO WAVEFORMS ===============
export const LFO_WAVEFORMS = {
    sine: phase => Math.sin(phase * Math.PI * 2),
    square: phase => phase < 0.5 ? 1 : -1,
    saw: phase => 2 * phase - 1,
    triangle: phase => 1 - 4 * Math.abs(phase - 0.5),
    snh: phase => {
        const idx = Math.floor(phase * 16);
        const x = Math.sin(idx * 127.1 + 311.7) * 43758.5453;
        return (x - Math.floor(x)) * 2 - 1;
    },
    noise: phase => {
        const idx = Math.floor(phase * 256);
        const nextIdx = (idx + 1) % 256;
        const x1 = Math.sin(idx * 127.1 + 311.7) * 43758.5453;
        const x2 = Math.sin(nextIdx * 127.1 + 311.7) * 43758.5453;
        const v1 = (x1 - Math.floor(x1)) * 2 - 1;
        const v2 = (x2 - Math.floor(x2)) * 2 - 1;
        const frac = (phase * 256) - idx;
        return v1 + (v2 - v1) * frac;
    }
};

export const LFO_BEAT_DIVISIONS = ['1/1', '1/2', '1/4', '1/8', '1/16'];

// =============== AUDIO TEXTURE ===============
export const AUDIO_FFT_SIZE = 256;
export const AUDIO_TEXTURE_WAVEFORM_UNIT = 3;
export const AUDIO_TEXTURE_SPECTRUM_UNIT = 4;

// =============== LAYER MEDIA TEXTURE UNITS ===============
export const LAYER_VIDEO_TEXTURE_UNIT = 5;
export const LAYER_IMAGE_TEXTURE_UNIT = 6;
export const LAYER_SRT_TEXTURE_UNIT = 7;

// =============== VISUALIZER SHADERS ===============
export const VISUALIZER_WAVEFORM_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform vec3 iResolution;
uniform float iTime;
uniform sampler2D u_audioWaveform;
uniform vec3 u_color;
uniform float u_gain;
uniform float u_thickness;
uniform int u_mode;
void main() {
    float wave = texture(u_audioWaveform, vec2(vUv.x, 0.5)).r;
    wave = (wave - 0.5) * 2.0 * u_gain;
    float shape = 0.0;
    if (u_mode == 0) {
        // Line mode
        shape = smoothstep(u_thickness + 0.002, u_thickness - 0.002, abs(vUv.y - 0.5 - wave));
    } else if (u_mode == 1) {
        // Filled mode
        float center = 0.5;
        float dist = abs(vUv.y - center);
        float fill = abs(wave);
        shape = smoothstep(fill + 0.002, fill - 0.002, dist);
    } else if (u_mode == 2) {
        // Dots mode
        float numDots = 64.0;
        float dotIndex = floor(vUv.x * numDots);
        float dotX = (dotIndex + 0.5) / numDots;
        float dotWave = texture(u_audioWaveform, vec2(dotX, 0.5)).r;
        dotWave = (dotWave - 0.5) * 2.0 * u_gain;
        float distX = abs(vUv.x - dotX) * numDots;
        float distY = abs(vUv.y - 0.5 - dotWave);
        float dotRadius = u_thickness * 5.0;
        shape = (1.0 - smoothstep(dotRadius - 0.5, dotRadius + 0.5, distX))
              * (1.0 - smoothstep(dotRadius - 0.5, dotRadius + 0.5, distY));
    }
    fragColor = vec4(u_color * shape, shape);
}`;

export const VISUALIZER_SPECTRUM_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform vec3 iResolution;
uniform float iTime;
uniform sampler2D u_audioSpectrum;
uniform vec3 u_color;
uniform float u_gain;
uniform float u_thickness;
uniform float u_freqMax;
uniform int u_mode;
float logFreq(float x) { return pow(x, 2.0) * u_freqMax; }
void main() {
    float freqX = logFreq(vUv.x);
    float freq = texture(u_audioSpectrum, vec2(freqX, 0.5)).r * u_gain;
    float shape = 0.0;
    if (u_mode == 0) {
        float numBars = 64.0;
        float barIndex = floor(vUv.x * numBars);
        float barX = (barIndex + 0.5) / numBars;
        float barFreq = texture(u_audioSpectrum, vec2(logFreq(barX), 0.5)).r * u_gain;
        float barWidth = u_thickness * 10.0;
        float inBar = 1.0 - smoothstep(barWidth - 0.01, barWidth + 0.01, abs(vUv.x - barX) * numBars * 0.5);
        float inHeight = 1.0 - smoothstep(barFreq - 0.002, barFreq + 0.002, vUv.y);
        shape = inBar * inHeight;
    } else if (u_mode == 1) {
        float dx = 1.0 / 256.0;
        float prevFreq = texture(u_audioSpectrum, vec2(logFreq(max(0.0, vUv.x - dx)), 0.5)).r * u_gain;
        float currFreq = freq;
        float nextFreq = texture(u_audioSpectrum, vec2(logFreq(min(1.0, vUv.x + dx)), 0.5)).r * u_gain;
        float minY = min(prevFreq, nextFreq);
        float maxY = max(prevFreq, nextFreq);
        float dist = max(0.0, vUv.y - maxY);
        if (vUv.y < minY) dist = minY - vUv.y;
        else if (vUv.y < maxY) {
            float t2 = (vUv.x - max(0.0, vUv.x - dx)) / (min(1.0, vUv.x + dx) - max(0.0, vUv.x - dx) + 0.0001);
            float interpY = mix(prevFreq, nextFreq, t2);
            dist = abs(vUv.y - interpY);
        }
        shape = smoothstep(u_thickness + 0.002, u_thickness - 0.002, dist);
    } else if (u_mode == 2) {
        shape = 1.0 - smoothstep(freq - 0.005, freq + 0.005, vUv.y);
    }
    fragColor = vec4(u_color * shape, shape);
}`;

export const VISUALIZER_CIRCULAR_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform vec3 iResolution;
uniform sampler2D u_audioSpectrum;
uniform vec3 u_color;
uniform float u_gain;
uniform float u_thickness;
uniform float u_freqMax;
uniform int u_mode;
void main() {
    vec2 centered = vUv - 0.5;
    float dist = length(centered);
    float angle = atan(centered.y, centered.x);
    float normalizedAngle = (angle + 3.14159265) / 6.28318531;
    float freqBin = pow(normalizedAngle, 2.0) * u_freqMax;
    float freq = texture(u_audioSpectrum, vec2(freqBin, 0.5)).r * u_gain;
    float innerRadius = 0.1;
    float outerRadius = innerRadius + freq * 0.35;
    float radialMask = smoothstep(outerRadius + 0.003, outerRadius - 0.003, dist)
                     * smoothstep(innerRadius - 0.003, innerRadius + 0.003, dist);
    float shape = 0.0;
    if (u_mode == 0) {
        float numBars = 128.0;
        float barAngle = floor(normalizedAngle * numBars) / numBars;
        float barCenter = (barAngle + 0.5 / numBars);
        float angleDist = abs(normalizedAngle - barCenter) * numBars;
        float barMask = 1.0 - smoothstep(u_thickness * 10.0 - 0.5, u_thickness * 10.0 + 0.5, angleDist);
        shape = barMask * radialMask;
    } else if (u_mode == 1) {
        shape = radialMask;
    } else {
        float numDots = 64.0;
        float dotIdx = floor(normalizedAngle * numDots);
        float dotAngle = (dotIdx + 0.5) / numDots;
        float dotFreqBin = pow(dotAngle, 2.0) * u_freqMax;
        float dotFreq = texture(u_audioSpectrum, vec2(dotFreqBin, 0.5)).r * u_gain;
        float dotR = innerRadius + dotFreq * 0.35;
        vec2 dotPos = vec2(cos(dotAngle * 6.28318531 - 3.14159265),
                           sin(dotAngle * 6.28318531 - 3.14159265)) * dotR + 0.5;
        float d = length(vUv - dotPos);
        float r = u_thickness * 5.0;
        shape = smoothstep(r + 0.003, r - 0.003, d);
    }
    fragColor = vec4(u_color * shape, shape);
}`;

export const VISUALIZER_OSCILLOSCOPE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform vec3 iResolution;
uniform sampler2D u_audioWaveform;
uniform vec3 u_color;
uniform float u_gain;
uniform float u_thickness;
uniform float iTime;
uniform int u_mode;
void main() {
    float shape = 0.0;
    float glow = 0.0;
    float samples = 128.0;
    float phase = iTime * 0.5;
    for (float i = 0.0; i < 128.0; i += 2.0) {
        float xSample = texture(u_audioWaveform, vec2(i / samples, 0.5)).r;
        float ySample;
        if (u_mode == 1) {
            float yIdx = mod(i + 32.0 + floor(phase) * 2.0, samples);
            ySample = texture(u_audioWaveform, vec2(yIdx / samples, 0.5)).r;
        } else {
            ySample = texture(u_audioWaveform, vec2((i + 1.0) / samples, 0.5)).r;
        }
        float amp = 0.8;
        float px = (xSample - 0.5) * 2.0 * u_gain * amp + 0.5;
        float py = (ySample - 0.5) * 2.0 * u_gain * amp + 0.5;
        float d = length(vUv - vec2(px, py));
        float dotSize = u_thickness * 1.5;
        shape += smoothstep(dotSize + 0.003, dotSize - 0.003, d);
        glow += smoothstep(dotSize * 4.0, 0.0, d) * 0.15;
        if (u_mode != 2 && i > 0.0) {
            float prevXSample, prevYSample;
            if (u_mode == 1) {
                float prevYIdx = mod(i - 2.0 + 32.0 + floor(phase) * 2.0, samples);
                prevXSample = texture(u_audioWaveform, vec2((i - 2.0) / samples, 0.5)).r;
                prevYSample = texture(u_audioWaveform, vec2(prevYIdx / samples, 0.5)).r;
            } else {
                prevXSample = texture(u_audioWaveform, vec2((i - 2.0) / samples, 0.5)).r;
                prevYSample = texture(u_audioWaveform, vec2((i - 1.0) / samples, 0.5)).r;
            }
            float prevPx = (prevXSample - 0.5) * 2.0 * u_gain * amp + 0.5;
            float prevPy = (prevYSample - 0.5) * 2.0 * u_gain * amp + 0.5;
            vec2 segA = vec2(prevPx, prevPy);
            vec2 segB = vec2(px, py);
            vec2 segDir = segB - segA;
            float segLen = length(segDir);
            if (segLen > 0.001) {
                float t2 = clamp(dot(vUv - segA, segDir) / dot(segDir, segDir), 0.0, 1.0);
                float lineDist = length(vUv - (segA + t2 * segDir));
                shape += smoothstep(u_thickness + 0.003, u_thickness - 0.003, lineDist);
                glow += smoothstep(u_thickness * 5.0, 0.0, lineDist) * 0.1;
            }
        }
    }
    shape = min(shape, 1.0);
    glow = min(glow, 1.0);
    float total = max(shape, glow);
    vec3 col = u_color * (shape + glow * 0.6);
    fragColor = vec4(col, total);
}`;

// =============== VISUALIZER TYPES ===============
export const VISUALIZER_TYPES = {
    waveform: { name: 'Waveform', shader: VISUALIZER_WAVEFORM_FS },
    spectrum: { name: 'Spectrum', shader: VISUALIZER_SPECTRUM_FS },
    circular: { name: 'Circular Spectrum', shader: VISUALIZER_CIRCULAR_FS },
    oscilloscope: { name: 'Oscilloscope (XY)', shader: VISUALIZER_OSCILLOSCOPE_FS }
};

export const VISUALIZER_DEFAULT_PARAMS = {
    visualizerType: 'waveform',
    gain: 1.0,
    thickness: 0.02,
    color: '#00ffff',
    mode: 0,
    freqMax: 1.0
};

// =============== COMMON CONSTANTS (for code parsing) ===============
export const COMMON_CONSTANTS = new Set([
    '0', '0.0', '1', '1.0', '-1', '-1.0', '2', '2.0', '-2', '-2.0',
    '3', '3.0', '4', '4.0', '5', '5.0', '6', '6.0', '7', '7.0', '8', '8.0', '9', '9.0',
    '3.14159', '3.141592', '3.1415926', '3.14159265', '3.141592653', '3.1415926535', '3.14159265359',
    '6.28318', '6.283185', '1.57079', '1.570796'
]);

// =============== DEFAULT SHADER CODE ===============
export const DEFAULT_SHADER_CODE = `// Obsidian Flow / Kinetic Bismuth
// (Inspired by recursive domain warping and non-Euclidean fluid dynamics)
vec3 palette(float t) {
    // A more "iridescent metal" palette: deep purples, golds, and neon cyans
    vec3 a = vec3(0.2, 0.1, 0.3);
    vec3 b = vec3(0.5, 0.4, 0.2);
    vec3 c = vec3(1.0, 1.0, 1.0);
    vec3 d = vec3(0.26, 0.41, 0.55);
    return a + b * cos(6.28318 * (c * t + d));
}
void main() {
    vec2 uv = (gl_FragCoord.xy - 0.5 * iResolution.xy) / iResolution.y;
    float t = iTime * 0.25;
    
    // Domain Warping: The "Liquid Crystal" effect
    vec2 p = uv;
    for (float i = 1.0; i < 4.0; i++) {
        p.x += 0.3 / i * sin(i * 3.0 * p.y + t);
        p.y += 0.3 / i * cos(i * 3.0 * p.x + t);
    }
    
    // Fractal Brownian Motion-esque layering
    float strength = 7.0;
    float d = 0.0;
    vec2 grid = p * strength;
    
    // Create sharp, angular "Bismuth" steps
    for (float j = 0.0; j < 3.0; j++) {
        grid = abs(grid) / dot(grid, grid) - 0.7;
        d += length(grid) * 0.15;
    }
    
    // The "Pulse": Lighting that reacts to the distortion
    float wave = sin(d * 10.0 - t * 2.0);
    float glow = smoothstep(0.1, 0.0, abs(wave));
    
    // Coloring based on the warped coordinates + the fractal distance
    vec3 col = palette(length(p) * 0.5 + d * 0.2);
    
    // Injecting the "Metallic" sheen
    col += (glow * 0.8) * vec3(0.8, 0.9, 1.0);
    col *= 1.2 - length(uv); // Soft natural vignette
    
    // Final punch: High-pass style contrast
    col = mix(col, col * col, 0.5);
    
    fragColor = vec4(col, 1.0);
}`;

export const SCANIMATE_DEFLECT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_resolution;
uniform float u_time;
uniform float u_speed;
uniform float u_deflectionX;
uniform float u_deflectionY;
uniform float u_rotation;
uniform float u_barrelAmount;
uniform int u_segmentCount;
uniform float u_segmentThresholds[4];
uniform float u_segmentDepthMultipliers[5];
uniform int u_domainWarpIterations;
uniform float u_oscValue[8];
uniform float u_waveXDepth;
uniform float u_waveYDepth;
uniform float u_segmentShift;
const float PI = 3.14159265359;
float getSegmentMul(vec2 uv) {
    float segY = uv.y + u_segmentShift;
    if (u_segmentCount <= 1) return u_segmentDepthMultipliers[0];
    if (segY < u_segmentThresholds[0]) return u_segmentDepthMultipliers[0];
    if (u_segmentCount <= 2 || segY < u_segmentThresholds[1]) return u_segmentDepthMultipliers[1];
    if (u_segmentCount <= 3 || segY < u_segmentThresholds[2]) return u_segmentDepthMultipliers[2];
    if (u_segmentCount <= 4 || segY < u_segmentThresholds[3]) return u_segmentDepthMultipliers[3];
    return u_segmentDepthMultipliers[4];
}
void main() {
    vec2 uv = vUv;
    vec2 centered = uv * 2.0 - 1.0;
    float r2 = dot(centered, centered);
    uv = centered * (1.0 + u_barrelAmount * r2) * 0.5 + 0.5;
    if (abs(u_rotation) > 0.001) {
        float c = cos(u_rotation);
        float s = sin(u_rotation);
        uv = mat2(c, -s, s, c) * (uv - 0.5) + 0.5;
    }
    for (int iter = 0; iter < 5; iter++) {
        if (iter >= u_domainWarpIterations) break;
        float segMul = getSegmentMul(uv);
        float waveX = u_deflectionX;
        float waveY = u_deflectionY;
        for (int i = 0; i < 8; i++) {
            float fi = float(i + 1);
            waveX += u_oscValue[i] * sin(uv.y * fi * 4.0) * u_waveXDepth;
            waveY += u_oscValue[i] * cos(uv.x * fi * 4.0) * u_waveYDepth;
        }
        uv += vec2(waveX, waveY) * segMul;
    }
    uv = clamp(uv, 0.0, 1.0);
    fragColor = texture(u_source, uv);
}`;

export const SCANIMATE_COLORIZE_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform int u_colorizerEnabled;
uniform vec3 u_colorA;
uniform vec3 u_colorB;
uniform vec3 u_colorC;
uniform float u_colorCycle;
uniform float u_brightnessBoost;
void main() {
    vec4 tex = texture(u_source, vUv);
    float lum = dot(tex.rgb, vec3(0.299, 0.587, 0.114));
    vec3 col;
    if (u_colorizerEnabled == 1) {
        col = mix(u_colorA, u_colorB, lum);
        float cycle = sin(u_colorCycle + lum * 6.2831853) * 0.5 + 0.5;
        col = mix(col, u_colorC, cycle);
    } else {
        col = vec3(lum);
    }
    col *= u_brightnessBoost;
    fragColor = vec4(col, tex.a);
}`;

export const SCANIMATE_FEEDBACK_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D u_currentFrame;
uniform sampler2D u_lastFrame;
uniform float u_feedbackAmount;
uniform float u_decay;
void main() {
    vec4 current = texture(u_currentFrame, vUv);
    vec4 last = texture(u_lastFrame, vUv);
    last.rgb *= u_decay;
    fragColor = mix(last, current, u_feedbackAmount);
}`;

export const SCANIMATE_CRT_FS = `#version 300 es
precision highp float;
in vec2 vUv;
out vec4 fragColor;
uniform sampler2D u_source;
uniform vec2 u_resolution;
uniform int u_scanlinesEnabled;
uniform float u_scanlineIntensity;
uniform int u_glowEnabled;
uniform float u_glowAmount;
uniform int u_chromaticEnabled;
uniform float u_chromaticAmount;
uniform int u_vignetteEnabled;
uniform float u_vignetteAmount;
void main() {
    vec2 uv = vUv;
    vec3 col;
    if (u_chromaticEnabled == 1) {
        float r = texture(u_source, uv + vec2(u_chromaticAmount, 0.0)).r;
        float g = texture(u_source, uv).g;
        float b = texture(u_source, uv - vec2(u_chromaticAmount, 0.0)).b;
        col = vec3(r, g, b);
    } else {
        col = texture(u_source, uv).rgb;
    }
    if (u_glowEnabled == 1) {
        vec2 texel = 1.5 / u_resolution;
        vec3 glow = texture(u_source, uv + vec2(texel.x, 0.0)).rgb
                   + texture(u_source, uv - vec2(texel.x, 0.0)).rgb
                   + texture(u_source, uv + vec2(0.0, texel.y)).rgb
                   + texture(u_source, uv - vec2(0.0, texel.y)).rgb;
        col += glow * 0.25 * u_glowAmount;
    }
    if (u_scanlinesEnabled == 1) {
        float scan = sin(gl_FragCoord.y * 3.14159265) * 0.5 + 0.5;
        col *= 1.0 - (1.0 - scan) * u_scanlineIntensity;
    }
    if (u_vignetteEnabled == 1) {
        float vig = 1.0 - dot(uv - 0.5, uv - 0.5) * u_vignetteAmount * 2.0;
        col *= clamp(vig, 0.0, 1.0);
    }
    fragColor = vec4(col, 1.0);
}`;

// =============== DEFAULT MEDIA SHADER CODE ===============
// Cover-fit display shaders for shader-mode layers. Each samples its respective
// per-layer media texture with aspect-correct "cover" fit (mirrors IMAGE_FS).
// The body is identical except for the sampler name.
function _mediaCoverShader(sampler) {
    return `// Media Shader — cover-fit display. Edit me!
void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    float imgA = u_layerTexRes.x / max(u_layerTexRes.y, 1.0);
    float canA = iResolution.x / iResolution.y;
    vec2 scale = vec2(1.0);
    if (imgA > canA) scale.x = canA / max(imgA, 0.0001);
    else scale.y = imgA / max(canA, 0.0001);
    uv = (uv - 0.5) / scale + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0)
        fragColor = vec4(0.0, 0.0, 0.0, 1.0);
    else
        fragColor = texture(${sampler}, uv);
}`;
}
export const DEFAULT_MEDIA_VIDEO_SHADER = _mediaCoverShader('iLayerVideo');
export const DEFAULT_MEDIA_IMAGE_SHADER = _mediaCoverShader('iLayerImage');
export const DEFAULT_MEDIA_SRT_SHADER = _mediaCoverShader('iLayerSRT');

// =============== AI PROMPT CONSTANTS ===============

export const AI_SHADER_BASE_PROMPT = `=== COMPLETE GLSL ES 3.0 REFERENCE ===

BUILT-IN FUNCTIONS (All Available):
- Trigonometry: sin(x), cos(x), tan(x), asin(x), acos(x), atan(y,x), atan(y_over_x)
- Exponential: pow(x,y), exp(x), log(x), exp2(x), log2(x), sqrt(x), inversesqrt(x)
- Common: abs(x), sign(x), floor(x), trunc(x), round(x), roundEven(x), ceil(x), fract(x)
- Modulo: mod(x,y), modf(x,out), min(x,y), max(x,y), clamp(x,minVal,maxVal)
- Interpolation: mix(x,y,a) = x*(1-a) + y*a, step(edge,x), smoothstep(edge0,edge1,x)
- Geometric: length(v), distance(p0,p1), dot(v0,v1), cross(v0,v1), normalize(v)
- Reflection: reflect(I,N), refract(I,N,eta)
- Matrix: matrixCompMult(x,y), outerProduct(c,r), transpose(m), determinant(m), inverse(m)
- Vector Relational: lessThan, lessThanEqual, greaterThan, greaterThanEqual, equal, notEqual
- Integer: uaddCarry, usubBorrow, umulExtended, imulExtended, bitfieldExtract, bitfieldInsert

=== CRITICAL TYPE RULES - NEVER BREAK THESE ===
1. Vector types MUST match exactly for operations:
   - vec4 + vec4 = vec4 ✓
   - vec4 + vec3 = ERROR ✗
   - Use swizzling: vec4.xyz converts vec4 to vec3
   
2. Assignments must match dimensions:
   - vec3 color = vec3(1.0, 0.0, 0.0) ✓
   - vec3 color = 1.0 ✗ (assigning float to vec3)
   - vec4 color = vec3(1.0) ✗ (vec3 to vec4 mismatch)
   
3. Function arguments must match:
   - dot(vec3, vec3) ✓
   - dot(vec4, vec3) ✗
   
4. fragColor MUST be vec4:
   - fragColor = vec4(1.0, 0.0, 0.0, 1.0) ✓
   - fragColor = 0.5 ✗
   - fragColor = vec3(1.0) ✗

5. DO NOT use gl_FragColor - it's deprecated in WebGL2
   - WebGL2 uses: out vec4 fragColor; then write to fragColor
   - NEVER write gl_FragColor = ... in WebGL2

=== UNIFORMS THAT DO NOT EXIST — NEVER USE ===
iMouse, iFrame, iTimeDelta, iFrameRate, iSampleRate, iDate
Shaders referencing any of these will fail to compile.

=== CODE STRUCTURE ===
The engine automatically prepends to your shader before compilation:
  #version 300 es
  precision highp float;
  All uniform declarations (iTime, iResolution, voices, audio, layer params, code dials)
  Voice wrapper code (renames your main() and iterates over active voices)

You can write complete GLSL including these or omit them — duplicates are stripped automatically.
Output your shader as helper functions + void main() writing to fragColor:

\`\`\`glsl
// Helper functions (optional — define hash, noise, etc. here)

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    vec3 col = vec3(0.0);

    // Your shader code here

    fragColor = vec4(col, 1.0);
}
\`\`\`

=== AVAILABLE UNIFORMS & FEATURES ===

CORE (always available):
- iTime: float — elapsed time in seconds
- iResolution: vec3 — (canvas width, height, 1.0)
- gl_FragCoord: vec4 — pixel coordinates (available inside main)
- fragColor: out vec4 — your output (MUST assign vec4)

VIDEO INPUTS (sampler2D, available when Camera/Screen is enabled):
- iVideo: live webcam feed
- iScreen: live screen capture
  vec4 cam = texture(iVideo, uv);  // uv is vec2(0.0-1.0)
  vec4 screen = texture(iScreen, uv);

PER-LAYER MEDIA (sampler2D, available on Media Shader layers when a media source is selected):
- iLayerVideo: video file texture (Media Shader layer with Video source)
- iLayerImage: image file texture (Media Shader layer with Image source)
- iLayerSRT: WebSRT live stream texture (Media Shader layer with WebSRT source)
- u_layerTexRes: vec2 — resolution of the active media texture (x, y in pixels)
  vec4 media = texture(iLayerVideo, uv);  // sample the video/image/stream
  // Cover-fit example using u_layerTexRes:
  float imgA = u_layerTexRes.x / max(u_layerTexRes.y, 1.0);
  float canA = iResolution.x / iResolution.y;
  vec2 scale = vec2(1.0);
  if (imgA > canA) scale.x = canA / imgA; else scale.y = imgA / canA;
  uv = (uv - 0.5) / scale + 0.5;

AUDIO TEXTURES (sampler2D, LUMINANCE format):
- u_audioWaveform: 256-sample time-domain waveform, values ~0.0-1.0 centered at 0.5
- u_audioSpectrum: 128-bin frequency-domain spectrum, values ~0.0-1.0
  float wave = texture(u_audioWaveform, vec2(uv.x, 0.5)).r;
  float freq = texture(u_audioSpectrum, vec2(pow(uv.x, 2.0), 0.5)).r;
  // Audio-reactive brightness:
  float bass = texture(u_audioSpectrum, vec2(0.1, 0.5)).r;
  col *= 0.5 + bass;

LAYER PARAMETERS (always available, can be modulated):
- u_brightness: brightness multiplier (default 1.0)
- u_speed: time speed multiplier (default 1.0)
- u_posX, u_posY: position offset (default 0.0)
- u_scale: scale factor (default 1.0)
- u_radius: mask radius (default 0.5)
- u_amount: general intensity (default 1.0)
- u_rotation: rotation angle (default 0.0)
- u_stretch: stretch factor (default 0.0)
- u_maskPosX, u_maskPosY: mask center (default 0.0)
- u_maskSoftness: mask feather (default 0.01)

=== ALPHA & LAYER COMPOSITING ===
- fragColor.a (4th component) is THIS LAYER'S per-pixel opacity (0.0 transparent → 1.0 opaque).
- Layers composite bottom-to-top: index 0 first, then 1...7, each layered over the previous. Pixels you make transparent reveal the layers beneath.
- Effective alpha = (layer opacity slider) × (shader's .a) × (radial mask). The engine blends with mix(base, layer, alpha), so output STRAIGHT (non-premultiplied) RGB — do NOT multiply col by alpha inside your shader.
- DEFAULT for full-screen effects: fragColor = vec4(col, 1.0) (fully opaque).
- For overlays / lower-thirds / strips / frames / watermarks: compute a coverage value and write fragColor = vec4(col, coverage). Set coverage = 0.0 where lower layers should show through; feather edges with smoothstep() for clean transitions.
- Keep alpha = 1.0 unless the user explicitly asks for transparency or a partial-screen element.

VOICE SYSTEM (4 polyphonic voices per layer):
Per-voice arrays (index 0..3):
  u_voiceActive[4]     — 1.0 if voice is active
  u_voiceNote[4]       — MIDI note number 0-127
  u_voiceVelocity[4]   — velocity normalized 0-1
  u_voiceEG[4]         — per-voice envelope output 0-1
  u_voicePosX[4]       — per-voice X offset
  u_voicePosY[4]       — per-voice Y offset
  u_voiceScale[4]      — per-voice scale
  u_voiceRotation[4]   — per-voice rotation
  u_voiceUsePos[4]     — whether position transform is applied
  u_voiceUseScale[4]   — whether scale transform is applied
  u_voiceUseRot[4]     — whether rotation transform is applied
Global voice uniforms:
  u_pitchBend          — pitch bend value
  u_channelPressure    — aftertouch
  u_kbdNote            — latest active note
  u_eg0, u_eg1, u_eg2, u_eg3 — per-voice EG aggregate (max of active voices)

The engine renders your main() once per active voice with transformed UVs and
accumulates results with equal weighting (no hardcoded amplitude gating).
To make visuals respond to EG envelopes, route eg0-eg3 to layer parameters
via the modulation matrix, or read voice uniforms directly:

  // Sum active voice contributions
  float voiceSum = 0.0;
  for (int i = 0; i < 4; i++) {
      if (u_voiceActive[i] > 0.5) {
          float note = u_voiceNote[i] / 127.0;
          voiceSum += note * u_voiceVelocity[i];
      }
  }
  col *= voiceSum;

  // Map note to hue
  for (int i = 0; i < 4; i++) {
      if (u_voiceActive[i] > 0.5) {
          float hue = u_voiceNote[i] / 127.0;
          col += hsv2rgb(vec3(hue, 0.8, u_voiceVelocity[i]));
      }
  }

CODE DIALS (auto-extracted numeric literals):
- Numeric literals in your shader are automatically extracted and replaced with
  uniforms u_param_cd0 .. u_param_cd25 (max 26 dials).
- Common constants (0, 1, 2, 3.14159, 6.28318, etc.) are NOT extracted.
- You do NOT declare these uniforms — the engine injects them automatically.
- Each dial is mapped to a keyboard key (q-w-e-r-t-y-u-i-o-p-a-s-d-f-g-h-j-k-l-z-x-c-v-b-n-m)
  for real-time adjustment.
- Code dials are modulation targets — they can be driven by LFOs, envelope generators,
  audio analysis, MIDI CC, aftertouch, pitchbend, keyboard, or macros.
- This means ANY numeric value you write can be modulated live without recompilation.
  Use meaningful numeric values in your shader to expose them as dials:
    float speed = 0.5;        // becomes u_param_cdN, adjustable + modulatable
    float scale = 3.0;        // becomes u_param_cdN, adjustable + modulatable
    float hue = 0.33;         // becomes u_param_cdN, adjustable + modulatable

IMPORTANT CODE DIAL RULES:
- Your numeric literals get replaced with u_param_cdN. This means:
  - Function signatures MUST use only common constants (0, 1, 2) for defaults,
    otherwise the replacement breaks the signature
  - Loop bounds like "for (int i = 0; i < 5; i++)" are safe (5 is integer, not extracted)
  - BUT if you pass a float as a function argument that the function doesn't accept,
    the extraction may cause type mismatches
  - Define helper functions with the SAME parameter count you call them with
  - Example: define fbm(vec2 p) with 1 param, call it with fbm(uv * 4.0) — NOT fbm(uv, 3.0)

MULTI-LAYER SYSTEM:
- 8 layers (index 0=Main) composited bottom-to-top
- Blend modes: normal, add, multiply, screen, overlay, lighten, darken, subtract, difference
- Per-layer: opacity, position, scale, rotation, mask, feedback loop
- Each layer has its own shader, voice mode, and modulation matrix

MODULATION SOURCES (drive layer params, voice params, and code dials):
MIDI / OSC: note, velocity, cc, aftertouch, pitchbend, kbd — these arrive IDENTICALLY from
  MIDI hardware (Web MIDI API) or the OSC UDP bridge.
OSC generic: /ch/{n} addresses (0-1, learnable as modulation source 'osc').
Envelopes: eg0, eg1, eg2, eg3
LFOs: lfo1, lfo2, lfo3, lfo4 (sine, square, triangle, saw, S&H, noise)
Audio: audio_peak, audio_band_low, audio_band_mid, audio_band_high
Macros: macro1..macro8

=== MIDI & OSC INPUT ===
Notes arrive from MIDI hardware OR the OSC UDP bridge and trigger the voice system
IDENTICALLY — u_voiceActive/Note/Velocity/EG reflect whichever source is active.
OSC note addresses: /note/{ch} [V/oct, vel] (0V = C4 / MIDI 60, 1V per octave) or
/noteon [ch, note, vel] (MIDI integers). CC, aftertouch, and pitchbend also arrive via
either source and drive the same modulation sources. All layers default to voiceMode 'poly'.

=== NOISE AND RANDOM FUNCTIONS ===
Do NOT use undefined functions. Copy these implementations into your shader when needed:

// Pseudo-random hash function (BASIC - use this!)
float hash(vec2 p) {
    return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

// 2D value noise
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

// Fractal Brownian Motion
float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * noise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
}

// HSV to RGB conversion (hsv.x = hue 0-1, hsv.y = sat 0-1, hsv.z = val 0-1)
vec3 hsv2rgb(vec3 hsv) {
    vec3 rgb = clamp(abs(mod(hsv.x * 6.0 + vec3(0.0, 4.0, 2.0), 6.0) - 3.0) - 1.0, 0.0, 1.0);
    return hsv.z * mix(vec3(1.0), rgb, hsv.y);
}

// RGB to HSV conversion
vec3 rgb2hsv(vec3 rgb) {
    vec4 p = rgb.g < rgb.b ? vec4(rgb.bg, -1.0, 2.0/3.0) : vec4(rgb.gb, 0.0, -1.0/3.0);
    vec4 q = rgb.r < p.x ? vec4(p.xyw, rgb.r) : vec4(rgb.r, p.yzx);
    float d = q.x - min(q.w, q.y);
    float e = 1.0e-10;
    return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
}`;

export const AI_SYSTEM_PROMPT_ROLE = `You are a GLSL shader generator for WebGL2 (OpenGL ES 3.0) running inside SlopShady, a real-time shader editor with multi-layer compositing, polyphonic voices, audio reactivity, and modulation routing. Generate fragment shaders that create visual effects, animations, or artistic patterns.

=== OUTPUT FORMAT ===
Wrap shader code in \`\`\`glsl blocks. Test mentally for type safety before outputting. Ensure fragColor is always assigned a vec4. Use the available uniforms (voices, audio, layer params) when the user's request involves MIDI reactivity, audio visualization, or modulation.

Fill in this template when generating shaders:
\`\`\`glsl
// Helper functions (optional — define hash, noise, etc. here)

void main() {
    vec2 uv = gl_FragCoord.xy / iResolution.xy;
    vec3 col = vec3(0.0);

    // Shader code here

    fragColor = vec4(col, 1.0);
}
\`\`\`

CURRENT SHADER CODE:
\`\`\`glsl
[SEND_SHADER_CODE]
\`\`\``;

export const AI_CHAT_PROMPT_ROLE = `You are analyzing a GLSL ES 3.0 fragment shader running in WebGL2 inside SlopShady, a real-time shader editor with multi-layer compositing, polyphonic voices, audio reactivity, and modulation routing.

The shader uses \`void main()\` with \`fragColor\` (out vec4) as output.

Notes and controls arrive via MIDI hardware OR a native OSC UDP bridge (V/Oct \`/note/{ch}\` or MIDI-style \`/noteon\`, plus \`/cc\`, \`/pitchbend\`, \`/channelpressure\`). Both sources feed the same per-layer voice and modulation engine identically.

CURRENT SHADER CODE:
\`\`\`glsl
[SEND_SHADER_CODE]
\`\`\`

Explain what this shader does, how it uses the available uniforms (voices, audio, layer params, code dials), its mathematical concepts, visual effects, and suggest optimizations or variations. If the shader could benefit from voice reactivity, audio reactivity, or modulation, explain how.`;

// =============== FEEDBACK PARAMS ===============
export const FEEDBACK_PARAMS = [
    { param: 'feedbackAmount', label: 'Amt', min: 0, max: 1, def: 0.5, fill: 50, tip: 'LAYER_FB_AMOUNT' },
    { param: 'feedbackDecay', label: 'Dcy', min: 0, max: 1, def: 0.9, fill: 90, tip: 'LAYER_FB_DECAY' },
    { param: 'feedbackZoom', label: 'Zm', min: 0.5, max: 2, def: 1.0, fill: 25, tip: 'LAYER_FB_ZOOM' },
    { param: 'feedbackRotate', label: 'Rot', min: -3.14, max: 3.14, def: 0, fill: 50, tip: 'LAYER_FB_ROTATE' },
    { param: 'feedbackOffsetX', label: 'OX', min: -0.5, max: 0.5, def: 0, fill: 50, tip: 'LAYER_FB_OX' },
    { param: 'feedbackOffsetY', label: 'OY', min: -0.5, max: 0.5, def: 0, fill: 50, tip: 'LAYER_FB_OY' },
    { param: 'feedbackSaturation', label: 'Sat', min: 0, max: 3, def: 1.0, fill: 33, tip: 'LAYER_FB_SAT' },
    { param: 'feedbackBrightness', label: 'Brt', min: 0, max: 3, def: 1.0, fill: 33, tip: 'LAYER_FB_BRT' },
];
