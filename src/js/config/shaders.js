/**
 * Shader Sources
 * GLSL shader strings and shader-related templates split from config.js
 */

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
    centered /= max(u_zoom, 0.001);
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
