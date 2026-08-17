/**
 * Live Tuning Module
 * Iterative shader refinement using AI with screenshot feedback
 */

import { getEl } from '../state.js';
import { AI_SHADER_BASE_PROMPT } from '../config.js';
import { escapeHtml, showError } from '../utils.js';
import { Capture } from '../features/capture.js';
import { Templates } from '../utils/templates.js';
import { CodeDials } from '../ui/codeDials.js';

export const LiveTuning = {
    active: false,
    abortController: null,
    reader: null,

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

        const screenshot = await Capture.canvas();
        const shaderCode = getEl('shaderCode').value;
        const lmUrl = getEl('apiUrl').value.trim();
        const bearerKey = getEl('bearerKey').value.trim();
        const model = getEl('modelNameImage').value.trim();
        const maxIterations = parseInt(getEl('liveTuningMaxIterations').value) || 20;

        this.abortController = new AbortController();

        fetch('/api/live-tuning/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            signal: this.abortController.signal,
            body: JSON.stringify({
                lm_studio_url: lmUrl,
                bearer_key: bearerKey,
                model: model,
                max_iterations: maxIterations,
                goal: prompt,
                initial_screenshot: screenshot.split(',')[1],
                shader_code: shaderCode,
                base_prompt: AI_SHADER_BASE_PROMPT
            })
        }).then(res => {
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            if (!res.body) throw new Error('No response body');
            return res.body.getReader();
        }).then(reader => {
            this.reader = reader;
            this.readSSE();
        }).catch(err => {
            this.log(`❌ Failed to start tuning: ${err.message}`, 'error');
            this.stop(false);
        });
    },

    async readSSE() {
        const decoder = new TextDecoder();
        let buffer = '';
        const reader = this.reader;

        while (reader) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            let lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.startsWith('event: ')) {
                    const eventType = line.slice(7);
                    i++;
                    if (i < lines.length && lines[i].startsWith('data: ')) {
                        try {
                            const data = JSON.parse(lines[i].slice(6));
                            await this.handleEvent(eventType, data);
                        } catch (e) {
                            this.log(`⚠️ Parse error: ${e.message}`, 'error');
                        }
                    }
                }
            }
        }
    },

    async handleEvent(type, data) {
        switch (type) {
            case 'status':
                this.log(data.message, data.level || 'info');
                break;
            case 'reply':
                this.log('💬 Reply received', 'info');
                break;
            case 'load_shader':
                const compileResult = window.WebGL?.compileProgram(data.shader_code, true);
                
                if (compileResult?.error) {
                    await fetch('/api/live-tuning/shader-result', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            success: false,
                            error: compileResult.error,
                            transformedSource: compileResult.transformedSource || null
                        })
                    });
                    this.log(`❌ Shader compilation failed: ${compileResult.error.substring(0, 100)}...`, 'error');
                } else {
                    getEl('shaderCode').value = data.shader_code;
                    if (window.WebGL) window.WebGL.initShader({ save: true });
                    CodeDials.render();
                    
                    await fetch('/api/live-tuning/shader-result', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            success: true,
                            transformedSource: compileResult?.transformedSource || null
                        })
                    });
                    this.log('✅ Shader loaded and compiled successfully', 'result');
                }
                break;
            case 'request_screenshot':
                const screenshot = (await Capture.canvas()).split(',')[1];
                await fetch('/api/live-tuning/screenshot', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ screenshot: screenshot })
                });
                this.log('📸 Screenshot sent to server', 'result');
                break;
            case 'finish':
                this.stop(true, data.summary);
                break;
        }
    },

    stop(userInitiated = false, summary = '') {
        if (!this.active) return;
        this.active = false;

        if (this.reader) {
            this.reader.cancel();
            this.reader = null;
        }
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
