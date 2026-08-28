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
import { getConnection, apiBase, authHeaders, directConnectionHint } from './connection.js';
import { Templates } from '../utils/templates.js';
import { CodeDials } from '../ui/codeDials.js';

const FENCE = '```';

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
            `- load_shader(shader_code): Load a new shader. ALWAYS use this after compilation errors to fix the code.\n` +
            `- get_screenshot(): Capture the current visual state.\n\n` +
            `=== ERROR HANDLING ===\n` +
            `If load_shader returns a compilation error, you MUST call load_shader again with the corrected code. Do not respond with text - fix the error and call the tool.\n\n` +
            `Goal: ${goal}`;
    },

    async _llmCall(model, messages, toolChoice) {
        const payload = {
            model: model,
            messages: messages,
            tools: LIVE_TUNING_TOOLS,
            tool_choice: toolChoice,
            temperature: 0.7,
            max_tokens: 4000,
            stream: true
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

        return this._collectStream(res.body);
    },

    async _collectStream(body) {
        const reader = body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let content = '';
        const toolCalls = [];

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
                const trimmed = line.trimEnd();
                if (!trimmed.startsWith('data: ')) continue;
                const jsonStr = trimmed.slice(6);
                if (jsonStr === '[DONE]') continue;

                try {
                    const json = JSON.parse(jsonStr);
                    const delta = json.choices?.[0]?.delta || {};

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
            }
        }

        return { content, toolCalls };
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
            let forceToolCall = false;
            let lastCompileError = null;

            while (iteration <= maxIterations) {
                if (!this.active) break;

                this.log(`Iteration ${iteration}/${maxIterations}...`, 'info');

                const toolChoice = forceToolCall
                    ? { type: 'function', function: { name: 'load_shader' } }
                    : 'auto';
                forceToolCall = false;

                const { content, toolCalls } = await this._llmCall(model, messages, toolChoice);

                const assistantMsg = { role: 'assistant', content: content || null };
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
                        content: 'Please continue tuning by calling load_shader() with improvements or get_screenshot() to see the current state.'
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

                    if (tc.name === 'load_shader') {
                        const shader = typeof fnArgs.shader_code === 'string' ? fnArgs.shader_code : '';
                        const compileResult = window.WebGL?.compileProgram(shader, true);

                        if (compileResult?.error) {
                            const err = compileResult.error;
                            lastCompileError = err;
                            forceToolCall = true;
                            const transformed = compileResult.transformedSource || '';
                            const errorMsg =
                                `Compilation failed with error:\n${err}\n\n` +
                                `The engine transforms your shader before compilation:\n` +
                                `1. Numeric literals are extracted and replaced with u_param_cdN uniform parameters (code dials)\n` +
                                `2. #version, precision, uniform, and out declarations are stripped (engine auto-provides them)\n` +
                                `3. Voice wrapper code is appended\n\n` +
                                `Here is the ACTUAL compiled source (with your numeric literals replaced by code dial uniforms):\n` +
                                `${FENCE}glsl\n${transformed}\n${FENCE}\n\n` +
                                `Fix the error and call load_shader() again. Do NOT use u_param_cdN directly — write normal numeric values and the engine will extract them.`;
                            messages.push({
                                role: 'tool',
                                tool_call_id: tc.id,
                                content: JSON.stringify({ success: false, error: errorMsg })
                            });
                            this.log(`❌ Shader compilation failed: ${err.substring(0, 100)}...`, 'error');
                        } else {
                            getEl('shaderCode').value = shader;
                            if (window.WebGL) window.WebGL.initShader({ save: true });
                            CodeDials.render();

                            const transformed = compileResult?.transformedSource || '';
                            let successMsg = 'Shader compiled and loaded successfully.';
                            if (transformed) {
                                successMsg += `\n\nHere is the compiled shader (your numeric literals replaced with code dial uniforms):\n${FENCE}glsl\n${transformed}\n${FENCE}`;
                            }
                            messages.push({
                                role: 'tool',
                                tool_call_id: tc.id,
                                content: JSON.stringify({ success: true, message: successMsg })
                            });
                            this.log('✅ Shader loaded and compiled successfully', 'result');
                        }
                    } else if (tc.name === 'get_screenshot') {
                        const shot = (await Capture.canvas({ format: 'image/jpeg', quality: 0.8 })).split(',')[1];
                        messages.push({
                            role: 'tool',
                            tool_call_id: tc.id,
                            content: JSON.stringify({ success: true, screenshot_data: shot, format: 'jpeg' })
                        });

                        let screenshotText = "Screenshot captured. Here's the current state:";
                        if (lastCompileError) {
                            screenshotText += `\n\nNote: The last shader failed to compile with this error:\n${lastCompileError}\n\nPlease fix this error and call load_shader() with corrected code.`;
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
        logEl.insertAdjacentHTML('beforeend', Templates.tuningLog(escapeHtml(message), type));
        logEl.scrollTop = logEl.scrollHeight;
    }
};
