/**
 * Live Tuning Module
 * Iterative shader refinement using AI with screenshot feedback.
 * The agentic loop runs in the browser; LLM calls go either directly
 * to the API or through the server relay, per the Connection setting.
 */

import { getEl } from '../state.js';
import { AI_SHADER_BASE_PROMPT } from '../config.js';
import { escapeHtml, showError } from '../utils.js';
import { Capture } from '../features/capture.js';
import { getConnection, apiBase, authHeaders, directConnectionHint, thinkingParams } from './connection.js';
import { Templates } from '../utils/templates.js';
import { CodeDials } from '../ui/codeDials.js';

const FENCE = '```';
const MAX_SCREENSHOTS_IN_HISTORY = 2;

const LIVE_TUNING_TOOLS = [
    {
        type: 'function',
        function: {
            name: 'load_shader',
            description: 'Load a complete modified shader into the editor.',
            parameters: {
                type: 'object',
                properties: {
                    shader_code: {
                        type: 'string',
                        description: 'The complete GLSL fragment shader code to load.'
                    }
                },
                required: ['shader_code']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'edit_shader',
            description: 'Apply targeted find/replace edits to the CURRENT shader — much cheaper than resending the whole file. Each edit finds old_code (must match exactly one location) and replaces it with new_code. Prefer for fixes, tweaks and small changes; use load_shader for full rewrites or when edits cannot match.',
            parameters: {
                type: 'object',
                properties: {
                    edits: {
                        type: 'array',
                        description: 'Ordered find/replace edits, applied sequentially.',
                        items: {
                            type: 'object',
                            properties: {
                                old_code: { type: 'string', description: 'Exact existing code to find — must be unique; include surrounding lines to disambiguate.' },
                                new_code: { type: 'string', description: 'Replacement text (empty string deletes the matched code).' }
                            },
                            required: ['old_code', 'new_code']
                        }
                    }
                },
                required: ['edits']
            }
        }
    },
    {
        type: 'function',
        function: {
            name: 'get_screenshot',
            description: 'Capture a screenshot of the current shader state.',
            parameters: { type: 'object', properties: {}, required: [] }
        }
    }
];

export const LiveTuning = {
    active: false,
    abortController: null,
    _tools: null,

    _sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    },

    _buildSystemPrompt(goal, shaderCode) {
        return `You are a shader tuning assistant for SlopShady, a WebGL2 GLSL shader editor with voices, audio reactivity, and modulation. You have access to tools.\n\n` +
            `${AI_SHADER_BASE_PROMPT}\n\n` +
            `When generating shaders, fill in this template:\n` +
            `${FENCE}glsl\n` +
            `// Helper functions (optional — define hash, noise, etc. here)\n\n` +
            `void main() {\n` +
            `    vec2 uv = gl_FragCoord.xy / iResolution.xy;\n` +
            `    vec3 col = vec3(0.0);\n\n` +
            `    // Shader code here\n\n` +
            `    fragColor = vec4(col, 1.0);\n` +
            `}\n` +
            `${FENCE}\n\n` +
            `(For transparency/overlays/lower-thirds, vary the 4th component of fragColor as coverage. See ALPHA & LAYER COMPOSITING in the reference above.)\n` +
            `CURRENT SHADER CODE:\n` +
            `${FENCE}glsl\n${shaderCode}\n${FENCE}\n\n` +
            `=== TOOLS AVAILABLE ===\n` +
            `- edit_shader(edits): Apply targeted find/replace edits to the CURRENT shader. Each edit's old_code must exactly match ONE location (include surrounding lines to disambiguate); new_code replaces it. PREFER this for fixes and small changes — it is much cheaper than resending the whole shader.\n` +
            `- load_shader(shader_code): Load a complete new shader. Use for full rewrites, or when edit_shader cannot match. ALWAYS use this after compilation errors that need structural changes.\n` +
            `- get_screenshot(): Capture the current visual state.\n\n` +
            `=== ERROR HANDLING ===\n` +
            `If a tool returns a compilation error, you MUST send corrected code again (edit_shader for targeted fixes, load_shader for a full rewrite). Do not respond with text - fix the error and call the tool.\n\n` +
            `Goal: ${goal}`;
    },

    _redactOldScreenshots(messages) {
        const shotIndices = [];
        for (let i = 0; i < messages.length; i++) {
            const msg = messages[i];
            if (msg.role !== 'tool' || typeof msg.content !== 'string') continue;
            let parsed = null;
            try { parsed = JSON.parse(msg.content); } catch (e) {}
            if (parsed && parsed.screenshot_data) shotIndices.push(i);
        }
        if (shotIndices.length <= MAX_SCREENSHOTS_IN_HISTORY) return;

        const cutoff = shotIndices[shotIndices.length - MAX_SCREENSHOTS_IN_HISTORY];

        for (const idx of shotIndices) {
            if (idx < cutoff) {
                messages[idx].content = JSON.stringify({ success: true, message: 'screenshot omitted to save context' });
            }
        }

        for (let i = 0; i < cutoff; i++) {
            const msg = messages[i];
            if (msg.role !== 'user' || !Array.isArray(msg.content)) continue;
            if (!msg.content.some(part => part && part.image_url)) continue;
            const textParts = msg.content.filter(part => part.type === 'text');
            msg.content = textParts.length ? textParts : '[screenshot omitted]';
        }
    },

    // Reasoning models (qwen3 etc.) inline <think>…</think> in content when the
    // server doesn't split reasoning into reasoning_content deltas. Providers ask
    // that reasoning never be replayed in history — and it bloats every request.
    // The live thinking display streams separately and is unaffected.
    // Mirrors how agent harnesses discard prior-turn thinking.
    _stripThinking(text) {
        return text
            .replace(/<think>[\s\S]*?<\/think>\s*/g, '')
            .replace(/<think>[\s\S]*$/g, '')
            .trim();
    },

    // Apply find/replace edits to shader source, all-or-nothing.
    // Exact match first; falls back to whitespace-lenient matching
    // (leading/trailing whitespace per line ignored), like OpenCode's edit tool.
    _applyEdits(source, edits) {
        const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        let text = source;
        for (let i = 0; i < edits.length; i++) {
            const label = `edit ${i + 1}/${edits.length}`;
            const oldCode = typeof edits[i]?.old_code === 'string' ? edits[i].old_code : null;
            const newCode = typeof edits[i]?.new_code === 'string' ? edits[i].new_code : '';
            if (!oldCode || !oldCode.trim()) return { ok: false, error: `${label}: old_code is empty` };

            const exactCount = text.split(oldCode).length - 1;
            if (exactCount === 1) {
                text = text.replace(oldCode, () => newCode);
                continue;
            }
            if (exactCount > 1) {
                return { ok: false, error: `${label}: old_code matches ${exactCount} locations — include surrounding lines so it matches exactly once` };
            }

            // whitespace-lenient fallback: ignore per-line leading/trailing whitespace
            const pattern = oldCode.split('\n')
                .map(l => l.trim())
                .map(l => (l ? '[ \\t]*' + esc(l) + '[ \\t]*' : '[ \\t]*'))
                .join('\\r?\\n');
            const re = new RegExp(pattern, 'g');
            const matches = text.match(re);
            if (!matches) {
                return { ok: false, error: `${label}: old_code not found in the current shader — copy the text EXACTLY from the shader you last sent (check whitespace and line breaks), or use load_shader for a full rewrite` };
            }
            if (matches.length > 1) {
                return { ok: false, error: `${label}: old_code matches ${matches.length} locations (whitespace-insensitive) — include surrounding lines so it matches exactly once` };
            }
            text = text.replace(re, () => newCode);
        }
        return { ok: true, text };
    },

    // Shared compile + load path for load_shader and edit_shader.
    // Pushes the tool response and returns { ok, error }.
    _compileAndLoad(messages, toolCallId, shader, opts = {}) {
        const compileResult = window.WebGL?.compileProgram(shader, true);

        if (compileResult?.error) {
            const err = compileResult.error;
            const transformed = compileResult.transformedSource || '';
            const errorMsg =
                `Compilation failed with error:\n${err}\n\n` +
                `The engine transforms your shader before compilation:\n` +
                `1. Numeric literals are extracted and replaced with u_param_cdN uniform parameters (code dials)\n` +
                `2. #version, precision, uniform, and out declarations are stripped (engine auto-provides them)\n` +
                `3. Voice wrapper code is appended\n\n` +
                `Here is the ACTUAL compiled source (with your numeric literals replaced by code dial uniforms):\n` +
                `${FENCE}glsl\n${transformed}\n${FENCE}\n\n` +
                `Fix the error and send the corrected code — edit_shader for targeted fixes, load_shader for a full rewrite. Do NOT use u_param_cdN directly — write normal numeric values and the engine will extract them.`;
            messages.push({
                role: 'tool',
                tool_call_id: toolCallId,
                content: JSON.stringify({ success: false, error: errorMsg })
            });
            this.log(`❌ Shader compilation failed: ${err.substring(0, 100)}...`, 'error');
            return { ok: false, error: err };
        }

        getEl('shaderCode').value = shader;
        if (window.WebGL) window.WebGL.initShader({ save: true });
        CodeDials.render();

        // edit path stays short on success; full rewrites echo the transformed
        // source so the model sees the dial mapping (existing behavior)
        let successMsg = (opts.note ? `${opts.note} ` : '') + 'Shader compiled and loaded successfully.';
        if (opts.echoTransformed && compileResult?.transformedSource) {
            successMsg += `\n\nHere is the compiled shader (your numeric literals replaced with code dial uniforms):\n${FENCE}glsl\n${compileResult.transformedSource}\n${FENCE}`;
        }
        messages.push({
            role: 'tool',
            tool_call_id: toolCallId,
            content: JSON.stringify({ success: true, message: successMsg })
        });
        this.log('✅ Shader loaded and compiled successfully', 'result');
        return { ok: true };
    },

    _trimHistory(messages, limit) {
        // 0 (or invalid) = keep everything; below 4 there is nothing coherent left to trim to
        if (!Number.isFinite(limit) || limit < 4) return;
        // messages[0] is the system prompt — always kept
        if (messages.length - 1 <= limit) return;

        let start = messages.length - limit;
        // Never open with an orphaned tool response: its assistant tool_calls
        // message must stay attached, so advance past any tool messages.
        while (start < messages.length && messages[start].role === 'tool') start++;
        if (start >= messages.length - 1) return;

        const removed = start - 1;
        messages.splice(1, removed);
        this.log(`🗂️ History trimmed: dropped ${removed} old message(s), sending ${messages.length - 1}`, 'info');
    },

    async _llmCall(model, messages, onThinkingDelta) {
        const payload = {
            model: model,
            messages: messages,
            tools: LIVE_TUNING_TOOLS,
            tool_choice: 'auto',
            temperature: 0.7,
            max_tokens: 100000,
            stream: true,
            ...thinkingParams()
        };

        let res;
        if (getConnection() === 'relay') {
            res = await fetch('/api/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lm_studio_url: apiBase(),
                    bearer_key: getEl('bearerKey').value.trim(),
                    ...payload
                }),
                signal: this.abortController.signal
            });
        } else {
            res = await fetch(apiBase() + '/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...authHeaders() },
                body: JSON.stringify(payload),
                signal: this.abortController.signal
            }).catch(err => {
                if (err.name === 'AbortError') throw err;
                throw new Error(directConnectionHint(err));
            });
        }

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`HTTP ${res.status} - ${errorText.substring(0, 300)}`);
        }
        if (!res.body) throw new Error('No response body');

        return this._collectStream(res.body, onThinkingDelta);
    },

    async _collectStream(body, onThinkingDelta) {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let content = '';
        let reasoning = '';
        const toolCalls = [];

        const processLine = (line) => {
            const trimmed = line.trimEnd();
            if (!trimmed.startsWith('data: ')) return;
            const jsonStr = trimmed.slice(6);
            if (jsonStr === '[DONE]') return;

            try {
                const json = JSON.parse(jsonStr);
                const delta = json.choices?.[0]?.delta || {};

                if (delta.reasoning_content || delta.reasoning) {
                    reasoning += (delta.reasoning_content || delta.reasoning);
                    if (onThinkingDelta) onThinkingDelta(delta.reasoning_content || delta.reasoning);
                }

                if (delta.content) content += delta.content;

                if (Array.isArray(delta.tool_calls)) {
                    for (const tc of delta.tool_calls) {
                        const idx = tc.index || 0;
                        while (idx >= toolCalls.length) {
                            toolCalls.push({ id: '', name: '', args: '' });
                        }
                        if (tc.id) toolCalls[idx].id += tc.id;
                        if (tc.function?.name) toolCalls[idx].name += tc.function.name;
                        if (tc.function?.arguments) toolCalls[idx].args += tc.function.arguments;
                    }
                }
            } catch (e) {}
        };

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                processLine(line);
            }
        }

        buffer += decoder.decode();
        if (buffer.trimEnd()) processLine(buffer);

        return { content, toolCalls, reasoning };
    },

    _beginThinkingDisplay() {
        const id = 'tuning-think-' + Date.now();
        const wrap = document.createElement('div');
        wrap.className = 'thinking-block';
        wrap.innerHTML = `<div class="thinking-header" data-toggle="${id}">
                <span class="toggle-icon">▼</span>
                <span>💭 Thinking...</span>
            </div>
            <div id="${id}" class="thinking-content visible"></div>`;
        const logEl = getEl('response');
        const pinned = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
        logEl.appendChild(wrap);
        if (pinned) logEl.scrollTop = logEl.scrollHeight;
        return wrap;
    },

    _updateThinkingDisplay(wrap, delta) {
        const contentEl = wrap.querySelector('.thinking-content');
        if (!contentEl) return;
        const logEl = getEl('response');
        const pinned = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
        contentEl.textContent += delta;
        if (pinned) logEl.scrollTop = logEl.scrollHeight;
    },

    _endThinkingDisplay(wrap, reasoning) {
        if (!reasoning) {
            wrap.remove();
            return;
        }
        const header = wrap.querySelector('.thinking-header span:last-child');
        if (header) header.textContent = '💭 Thinking (click to expand)';
        const icon = wrap.querySelector('.toggle-icon');
        if (icon) icon.textContent = '▶';
        const contentEl = wrap.querySelector('.thinking-content');
        if (contentEl) contentEl.classList.remove('visible');
    },

    async start() {
        const prompt = getEl('liveTuningPrompt').value.trim();
        if (!prompt) {
            showError('Please enter a tuning goal.');
            return;
        }

        this.active = true;
        getEl('startLiveTuning').disabled = true;
        getEl('stopLiveTuning').disabled = false;
        getEl('response').innerHTML = '';
        getEl('status').textContent = 'Starting tuning session...';

        const screenshot = await Capture.canvas({ format: 'image/jpeg', quality: 0.8 });
        const shaderCode = getEl('shaderCode').value;
        const model = getEl('modelNameImage').value.trim();
        const maxIterations = parseInt(getEl('liveTuningMaxIterations').value) || 20;
        const historyLimit = parseInt(getEl('liveTuningHistoryLimit').value) || 0;

        this.abortController = new AbortController();

        const systemContent = this._buildSystemPrompt(prompt, shaderCode);
        const messages = [
            { role: 'system', content: systemContent },
            {
                role: 'user',
                content: [
                    { type: 'text', text: prompt },
                    { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${screenshot.split(',')[1]}` } }
                ]
            }
        ];

        this.log('Starting live tuning...', 'info');

        try {
            let iteration = 1;
            let lastCompileError = null;

            while (iteration <= maxIterations) {
                if (!this.active) break;

                this.log(`Iteration ${iteration}/${maxIterations}...`, 'info');

                this._trimHistory(messages, historyLimit);

                const thinkWrap = this._beginThinkingDisplay();
                const { content, toolCalls, reasoning } = await this._llmCall(model, messages, (delta) => this._updateThinkingDisplay(thinkWrap, delta));
                this._endThinkingDisplay(thinkWrap, reasoning);

                const cleanedContent = this._stripThinking(content || '');
                const assistantMsg = { role: 'assistant', content: cleanedContent || null };
                assistantMsg.tool_calls = toolCalls.length
                    ? toolCalls.map(tc => ({
                        id: tc.id,
                        type: 'function',
                        function: { name: tc.name, arguments: tc.args }
                    }))
                    : null;
                messages.push(assistantMsg);

                if (content) this.log('💬 Reply received', 'info');

                if (!toolCalls.length) {
                    this.log('No tool calls. Asking to continue...', 'info');
                    messages.push({
                        role: 'user',
                        content: 'Please continue tuning by calling edit_shader() with targeted improvements, load_shader() for a full rewrite, or get_screenshot() to see the current state.'
                    });
                    await this._sleep(500);
                    iteration++;
                    continue;
                }

                this.log(`🔧 Model requested ${toolCalls.length} tool call(s)`, 'tool');

                if (toolCalls.length > 10) {
                    this.log(`⚠️ Too many tool calls (${toolCalls.length}), limiting to 10`, 'error');
                    toolCalls.length = 10;
                }

                for (const tc of toolCalls) {
                    if (!this.active) break;

                    let fnArgs = {};
                    try { fnArgs = JSON.parse(tc.args || '{}'); } catch (e) {}
                    if (Array.isArray(fnArgs)) fnArgs = fnArgs[0] && typeof fnArgs[0] === 'object' ? fnArgs[0] : {};

                    if (tc.name === 'load_shader') {
                        const shader = typeof fnArgs.shader_code === 'string' ? fnArgs.shader_code : '';
                        if (!shader.trim() || !shader.includes('void main')) {
                            messages.push({
                                role: 'tool',
                                tool_call_id: tc.id,
                                content: JSON.stringify({
                                    success: false,
                                    error: 'shader_code was missing, empty, or truncated (no void main found). Send the COMPLETE shader — a single JSON object {"shader_code": "..."} (not an array), ending with the closing brace of main().'
                                })
                            });
                            this.log('⚠️ Model sent an incomplete shader — asking for a full resend', 'error');
                            continue;
                        }
                        const result = this._compileAndLoad(messages, tc.id, shader, { echoTransformed: true });
                        if (!result.ok) lastCompileError = result.error;
                    } else if (tc.name === 'edit_shader') {
                        const edits = Array.isArray(fnArgs.edits) ? fnArgs.edits.slice(0, 50) : [];
                        if (!edits.length) {
                            messages.push({
                                role: 'tool',
                                tool_call_id: tc.id,
                                content: JSON.stringify({
                                    success: false,
                                    error: 'edits was missing or empty. Send {"edits": [{"old_code": "exact existing code", "new_code": "replacement"}]} — old_code must match exactly one location in the current shader.'
                                })
                            });
                            this.log('⚠️ edit_shader called with no edits', 'error');
                            continue;
                        }
                        const result = this._applyEdits(getEl('shaderCode').value, edits);
                        if (!result.ok) {
                            messages.push({
                                role: 'tool',
                                tool_call_id: tc.id,
                                content: JSON.stringify({ success: false, error: `No edits were applied (atomic — all or nothing). ${result.error}` })
                            });
                            this.log(`⚠️ Edit failed: ${result.error}`, 'error');
                            continue;
                        }
                        const applied = this._compileAndLoad(messages, tc.id, result.text, { note: `Applied ${edits.length} edit(s).` });
                        if (!applied.ok) lastCompileError = applied.error;
                    } else if (tc.name === 'get_screenshot') {
                        const shot = (await Capture.canvas({ format: 'image/jpeg', quality: 0.8 })).split(',')[1];
                        this._redactOldScreenshots(messages);
                        messages.push({
                            role: 'tool',
                            tool_call_id: tc.id,
                            content: JSON.stringify({ success: true, screenshot_data: shot, format: 'jpeg' })
                        });

                        let screenshotText = "Screenshot captured. Here's the current state:";
                        if (lastCompileError) {
                            screenshotText += `\n\nNote: The last shader failed to compile with this error:\n${lastCompileError}\n\nPlease fix this error and send corrected code via edit_shader or load_shader.`;
                            lastCompileError = null;
                        }

                        messages.push({
                            role: 'user',
                            content: [
                                { type: 'text', text: screenshotText },
                                { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${shot}` } }
                            ]
                        });
                        this.log('📸 Screenshot sent to model', 'result');
                    } else {
                        messages.push({
                            role: 'tool',
                            tool_call_id: tc.id,
                            content: JSON.stringify({ success: false, error: `Unknown tool: ${tc.name}` })
                        });
                        this.log(`⚠️ Unknown tool requested: ${tc.name}`, 'error');
                    }
                }

                if (!this.active) break;

                await this._sleep(500);
                iteration++;
            }

            if (this.active) this.stop(true, `Stopped after ${maxIterations} iterations.`);
        } catch (err) {
            if (err.name !== 'AbortError') {
                this.log(`❌ ${err.message}`, 'error');
                getEl('status').textContent = '❌ Tuning failed.';
                this.stop(false);
            }
        }
    },

    stop(userInitiated = false, summary = '') {
        if (!this.active) return;
        this.active = false;

        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }

        getEl('startLiveTuning').disabled = false;
        getEl('stopLiveTuning').disabled = true;

        if (userInitiated) {
            this.log(`🏁 Tuning finished: ${summary}`, 'finish');
            getEl('status').textContent = 'Tuning session ended.';
        } else {
            this.log('⏹ Tuning stopped.', 'info');
            getEl('status').textContent = 'Tuning stopped.';
        }
    },

    log(message, type = 'info') {
        const logEl = getEl('response');
        const pinned = logEl.scrollHeight - logEl.scrollTop - logEl.clientHeight < 40;
        logEl.insertAdjacentHTML('beforeend', Templates.tuningLog(escapeHtml(message), type));
        if (pinned) logEl.scrollTop = logEl.scrollHeight;
    }
};
