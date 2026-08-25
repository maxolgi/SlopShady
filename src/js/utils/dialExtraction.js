/**
 * Dial Extraction Utilities
 * Shared numeric-literal lexer for shader code dials (compile-time uniform
 * substitution and the code-dials overlay both consume this).
 */

import { SHADER_BUILTINS, COMMON_CONSTANTS } from '../config.js';

/**
 * Extract dial-able numeric literals from GLSL code.
 * Skips '#'-prefixed lines, 'const '-prefixed lines, // comments,
 * for-loop parenthesized expressions, typed array-bracket indices,
 * numbers adjacent to identifier chars, and COMMON_CONSTANTS/SHADER_BUILTINS.
 * @param {string} code Raw shader source ('\r\n' normalized to '\n')
 * @returns {Array<{key: string, originalValue: number, currentValue: number, pos: number, str: string}>} Sorted by pos ascending
 */
export function extractDials(code) {
    const params = [];
    const normalizedCode = code.replace(/\r\n/g, '\n');
    const lines = normalizedCode.split('\n');
    const numRe = /-?\d+(\.\d+)?([eE][-+]?\d+)?/g;
    let globalPos = 0;
    let idx = 0;

    for (const line of lines) {
        const trimmedLine = line.trim();

        if (trimmedLine.startsWith('#') || trimmedLine.startsWith('const ')) {
            globalPos += line.length + 1;
            continue;
        }

        const commentAt = line.indexOf('//');
        const scan = commentAt === -1 ? line : line.slice(0, commentAt);
        const isForLoop = trimmedLine.startsWith('for') || line.includes('for(');

        const forSpans = [];
        const arrSpans = [];
        let parenDepth = 0;
        let inForLoopExpr = false;
        let forSpanStart = -1;
        let bracketDepth = 0;
        let inArrayBrackets = false;
        let sawIdentifierBeforeBracket = false;
        let arrSpanStart = -1;

        for (let j = 0; j < scan.length; j++) {
            const c = scan[j];
            if (isForLoop) {
                if (c === '(') {
                    parenDepth++;
                    inForLoopExpr = true;
                    if (forSpanStart === -1) forSpanStart = j;
                } else if (c === ')') {
                    parenDepth--;
                    if (parenDepth <= 0) {
                        if (inForLoopExpr) forSpans.push([forSpanStart, j]);
                        inForLoopExpr = false;
                        forSpanStart = -1;
                    }
                }
            }
            if (c === '[') {
                bracketDepth++;
                sawIdentifierBeforeBracket = /[a-zA-Z_]\w*\s*$/.test(scan.substring(0, j));
                inArrayBrackets = true;
            } else if (c === ']') {
                bracketDepth--;
                if (bracketDepth <= 0) {
                    inArrayBrackets = false;
                    sawIdentifierBeforeBracket = false;
                }
            }
            if (inArrayBrackets && bracketDepth === 1 && sawIdentifierBeforeBracket) {
                if (arrSpanStart === -1) arrSpanStart = j;
            } else if (arrSpanStart !== -1) {
                arrSpans.push([arrSpanStart, j]);
                arrSpanStart = -1;
            }
        }
        if (forSpanStart !== -1) forSpans.push([forSpanStart, scan.length]);
        if (arrSpanStart !== -1) arrSpans.push([arrSpanStart, scan.length]);

        let declSeen = false;
        let fi = 0;
        let ai = 0;
        let m;
        numRe.lastIndex = 0;

        while ((m = numRe.exec(scan)) !== null) {
            const s = m.index;
            const numStr = m[0];
            while (fi < forSpans.length && forSpans[fi][1] <= s) fi++;
            while (ai < arrSpans.length && arrSpans[ai][1] <= s) ai++;
            const inForSpan = fi < forSpans.length && forSpans[fi][0] <= s;
            const inArrSpan = ai < arrSpans.length && arrSpans[ai][0] <= s;
            const prev = s > 0 ? scan.charCodeAt(s - 1) : 0;
            if (inForSpan || prev === 95 || (prev >= 65 && prev <= 90) || (prev >= 97 && prev <= 122)) {
                numRe.lastIndex = s + 1;
                continue;
            }
            if (inArrSpan) {
                if (!declSeen) {
                    declSeen = /\b(vec|mat|int|float|uint|bool|sampler)\d*\s+[a-zA-Z_]/.test(scan.substring(0, s).toLowerCase());
                }
                if (declSeen) {
                    numRe.lastIndex = s + 1;
                    continue;
                }
            }
            const next = scan.charCodeAt(s + numStr.length);
            const num = parseFloat(numStr);
            if (!SHADER_BUILTINS.has(numStr) &&
                !COMMON_CONSTANTS.has(numStr) &&
                !(next === 95 || (next >= 65 && next <= 90) || (next >= 97 && next <= 122))) {
                params.push({
                    key: 'cd' + idx,
                    originalValue: num,
                    currentValue: num,
                    pos: globalPos + s,
                    str: numStr
                });
                idx++;
            }
        }
        globalPos += line.length + 1;
    }
    return params;
}
