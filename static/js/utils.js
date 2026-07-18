/**
 * Utility Functions
 * Common utility functions used across the application
 */

import { COMPOSITE_VS } from './config.js';

/**
 * Escape HTML special characters
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
export function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function toggleFullscreen() {
    if (window.ipc) {
        window.ipc.postMessage('toggle-fullscreen');
        return;
    }
    const el = document.documentElement;
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        (el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen).call(el);
    } else {
        (document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen).call(document);
    }
}

/**
 * Show a non-blocking error message to the user
 * Displays in the status element and auto-clears after 5 seconds
 * @param {string} message - Error message to display
 */
export function showError(message) {
    const el = document.getElementById('status');
    if (el) {
        el.innerHTML = `<span class="msg-error">ERROR: ${escapeHtml(message)}</span>`;
        setTimeout(() => {
            if (el.querySelector('.msg-error')?.textContent === 'ERROR: ' + message) {
                el.textContent = '';
            }
        }, 5000);
    }
    console.error(message);
}

/**
 * Estimate token count from text length
 * @param {string} text - Text to estimate
 * @returns {number} Estimated token count
 */
export function estimateTokens(text) {
    return text ? Math.ceil(text.length / 4) : 0;
}

/**
 * Get line and column from position in code
 * @param {string} code - Source code
 * @param {number} pos - Position in code
 * @returns {{line: number, column: number}} Line and column numbers
 */
export function getLineFromPosition(code, pos) {
    let line = 1, column = 1;
    for (let i = 0; i < pos && i < code.length; i++) {
        if (code[i] === '\n') { line++; column = 1; }
        else { column++; }
    }
    return { line, column };
}

/**
 * Save value to localStorage
 * @param {string} key - Storage key
 * @param {string} value - Value to store
 */
export function saveToLocalStorage(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        console.warn('Failed to save to localStorage:', e);
    }
}

/**
 * Load value from localStorage
 * @param {string} key - Storage key
 * @param {string} defaultValue - Default value if not found
 * @returns {string} Stored value or default
 */
export function loadFromLocalStorage(key, defaultValue) {
    try {
        const value = localStorage.getItem(key);
        return value !== null ? value : defaultValue;
    } catch (e) {
        console.warn('Failed to load from localStorage:', e);
        return defaultValue;
    }
}

/**
 * Convert hex color to RGB array
 * @param {string} hex - Hex color string (#RRGGBB)
 * @returns {number[]} RGB array [r, g, b] normalized 0-1
 */
export function hexToRgb(hex) {
    const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
    if (!result) return [0, 0, 0];
    return [
        parseInt(result[1], 16) / 255,
        parseInt(result[2], 16) / 255,
        parseInt(result[3], 16) / 255
    ];
}

/**
 * Programmatically set a custom dropdown's selected value.
 * Syncs the active item and button label to match the value.
 * @param {string} menuId - The ID of the .dropdown__menu element
 * @param {string} value - The data-value to select
 */
export function setDropdownValue(menuId, value) {
    const menu = document.getElementById(menuId);
    if (!menu) return;
    const dropdown = menu.closest('.dropdown');
    let matched = null;
    menu.querySelectorAll('.dropdown__item').forEach(item => {
        const isActive = item.dataset.value === value;
        item.classList.toggle('active', isActive);
        if (isActive) matched = item;
    });
    if (matched) {
        const btn = dropdown?.querySelector('.dropdown__selected span');
        if (btn) btn.textContent = matched.textContent;
    }
}

/**
 * Compile utility shader program
 * @param {WebGL2RenderingContext} gl - WebGL context
 * @param {string} fsSource - Fragment shader source
 * @param {string} vsSource - Vertex shader source (optional)
 * @returns {WebGLProgram|null} Compiled program or null
 */
export function compileUtilityProgram(gl, fsSource, vsSource) {
    if (!gl) return null;
    
    const vsSrc = vsSource || COMPOSITE_VS;
    
    function compileShader(type, source) {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            console.error('Shader compile error:', gl.getShaderInfoLog(shader));
            gl.deleteShader(shader);
            return null;
        }
        return shader;
    }
    
    const vs = compileShader(gl.VERTEX_SHADER, vsSrc);
    const fs = compileShader(gl.FRAGMENT_SHADER, fsSource);
    
    if (!vs || !fs) {
        if (vs) gl.deleteShader(vs);
        if (fs) gl.deleteShader(fs);
        return null;
    }
    
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error('Program link error:', gl.getProgramInfoLog(program));
        gl.deleteProgram(program);
        return null;
    }
    
    return program;
}
