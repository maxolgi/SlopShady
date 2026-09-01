/**
 * LLM Module
 * Handles AI communication via LM Studio API
 */

import { state, getEl } from '../state.js';
import { AI_SHADER_BASE_PROMPT, AI_SYSTEM_PROMPT_ROLE, AI_CHAT_PROMPT_ROLE } from '../config.js';
import { Conversation } from './conversation.js';
import { getConnection, apiBase, authHeaders, directConnectionHint } from './connection.js';
import { ContentParser } from '../utils/contentParser.js';
import { Capture } from '../features/capture.js';
import { Templates } from '../utils/templates.js';
import { escapeHtml } from '../utils.js';
import { WebGL } from '../webgl/core.js';
import { CodeDials } from '../ui/codeDials.js';

export const LLM = {
    abortController: null,
    _streamRafId: null,
    _streamGeneration: 0,
    _streamFlushPending: false,
    _streamingContentEl: null,
    _streamState: null,
    _fixRetries: 0,

    _cancelStreamFlush() {
        if (this._streamRafId !== null) {
            cancelAnimationFrame(this._streamRafId);
            this._streamRafId = null;
        }
        this._streamGeneration++;
        this._streamFlushPending = false;
        this._streamState = null;
        this._streamingContentEl = null;
    },

    _scheduleStreamFlush() {
        if (this._streamFlushPending) return;
        this._streamFlushPending = true;
        const gen = this._streamGeneration;
        this._streamRafId = requestAnimationFrame(() => {
            this._streamRafId = null;
            this._streamFlushPending = false;
            this._flushStream(gen);
        });
    },

    _flushStream(gen) {
        if (gen !== this._streamGeneration) return;
        const streamingDiv = this._streamingContentEl;
        const streamState = this._streamState;
        if (!streamingDiv || !streamState) return;
        const { accumulated, reasoningAccumulated } = streamState;
        let displayHtml = '';
        if (reasoningAccumulated) {
            const thinkDone = !!accumulated;
            const thinkId = 'stream-reasoning';
            displayHtml += `<div class="thinking-block">
                <div class="thinking-header" data-toggle="${thinkId}">
                    <span class="toggle-icon">${thinkDone ? '▶' : '▼'}</span>
                    <span>💭 Thinking ${thinkDone ? '(click to expand)' : '...'}</span>
                </div>
                <div id="${thinkId}" class="thinking-content ${thinkDone ? '' : 'visible'}">${escapeHtml(reasoningAccumulated)}${!thinkDone ? '<span class="cursor">|</span>' : ''}</div>
            </div>`;
        }
        if (accumulated) {
            displayHtml += state.llmMode === 'shader'
                ? '<div class="msg-success">✍️ Generating shader...<span class="cursor">|</span></div>'
                : this.renderStreamingContent(accumulated, false);
        }
        if (!accumulated && !reasoningAccumulated) {
            displayHtml += '<span class="cursor">|</span>';
        }
        streamingDiv.innerHTML = displayHtml;
        const resp = getEl('response');
        if (resp) resp.scrollTop = 1e9;
        Conversation.updateTokenCount();
    },

    setCancelMode(cancelMode) {
        const btn = getEl('askLLM');
        const btnImg = getEl('askLLMWithImage');
        if (cancelMode) {
            btn.textContent = '⏹ Cancel';
            btnImg.disabled = true;
        } else {
            btn.textContent = 'Send';
            btnImg.disabled = false;
        }
    },
    
    cancel() {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
            this.setCancelMode(false);
            this._cancelStreamFlush();
            getEl('status').textContent = '❌ Request cancelled.';
        }
    },
    
    async send(includeImage = false, overrideMessage = null) {
        if (overrideMessage === null) this._fixRetries = 0;
        if (this.abortController) {
            this.cancel();
            return;
        }
        
        const status = getEl('status');
        const userInput = getEl('userMessage');
        let userMessage = overrideMessage ?? userInput.value.trim();
        
        if (!includeImage && !userMessage) {
            status.textContent = '❌ Please enter a message first.';
            return;
        }
        
        if (includeImage && !userMessage) userMessage = "[Analyze current shader state]";
        
        status.textContent = includeImage ? 'Capturing frame and contacting the oracle...' : 'Sending message...';
        userInput.value = '';
        
        const myController = new AbortController();
        this.abortController = myController;
        this.setCancelMode(true);
        
        const apiUrl = getEl('apiUrl').value.trim();
        const model = includeImage ? getEl('modelNameImage').value.trim() : getEl('modelNameText').value.trim();
        const roleTemplate = state.llmMode === 'chat' ? AI_CHAT_PROMPT_ROLE : AI_SYSTEM_PROMPT_ROLE;
        const shaderCode = getEl('shaderCode').value;
        
        const fullSystemPrompt = AI_SHADER_BASE_PROMPT + '\n\n' + roleTemplate.replace('[SEND_SHADER_CODE]', shaderCode);
        const messages = [
            { role: "system", content: fullSystemPrompt },
            ...state.conversationHistory
        ];
        
        let userContent;
        if (includeImage) {
            const dataUrl = await Capture.canvas();
            const base64 = dataUrl.split(',')[1];
            userContent = [
                { type: "text", text: userMessage },
                { type: "image_url", image_url: { url: `data:image/png;base64,${base64}` } }
            ];
        } else {
            userContent = userMessage;
        }
        
        messages.push({ role: "user", content: userContent });
        
        Conversation.add('user', userMessage);
        
        let assistantIndex = state.conversationHistory.length;
        const bearerKey = getEl('bearerKey').value.trim();
        
        const payload = {
            model: model,
            messages: messages,
            temperature: 0.7,
            max_tokens: 100000,
            stream: true
        };
        if (state.llmMode === 'shader') {
            payload.response_format = {
                type: 'json_schema',
                json_schema: {
                    name: 'shader_response',
                    strict: true,
                    schema: {
                        type: 'object',
                        properties: { shader_code: { type: 'string' } },
                        required: ['shader_code'],
                        additionalProperties: false
                    }
                }
            };
        }

        try {
            let res;
            if (getConnection() === 'relay') {
                res = await fetch('/api/chat/completions', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        lm_studio_url: apiUrl,
                        bearer_key: bearerKey,
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
                console.error('API Error Response:', errorText);
                throw new Error(`HTTP ${res.status} - ${errorText}`);
            }
            
            if (!res.body) {
                throw new Error('No response body available');
            }
            
            await this.streamResponse(res, assistantIndex, model, status);
        } catch (err) {
            if (err.name === 'AbortError') {
                getEl('response').innerHTML = '<span class="msg-warning">Request cancelled by user.</span>';
                status.textContent = '⏹ Cancelled.';
            } else {
                getEl('response').innerHTML = `<span class="msg-error">ERROR: ${escapeHtml(err.message)}</span>`;
                status.textContent = '❌ Request failed.';
                console.error(err);
            }
        } finally {
            if (this.abortController === myController) {
                this.abortController = null;
                this.setCancelMode(false);
            }
        }
    },

    async streamResponse(res, assistantIndex, model, status) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';
        let reasoningAccumulated = '';
        let isThinking = false;
        let assistantMessageAdded = false;
        
        status.textContent = '💭 Thinking...';
        this._streamGeneration++;
        this._streamingEntry = document.createElement('div');
        this._streamingEntry.className = 'response-entry';
        this._streamingEntry.innerHTML = `<strong>LM Studio (${escapeHtml(model)})</strong><br><br><div class="streaming-content"></div>`;
        this._streamingContentEl = this._streamingEntry.querySelector('.streaming-content');
        getEl('response').appendChild(this._streamingEntry);
        
        let pending = '';
        const processLine = (line) => {
            const trimmed = line.trimEnd();
            if (!trimmed.startsWith('data: ')) return;
            const jsonStr = trimmed.slice(6);
            if (jsonStr === '[DONE]') return;

            try {
                const json = JSON.parse(jsonStr);
                const deltaObj = json.choices?.[0]?.delta || {};
                const contentDelta = deltaObj.content || '';
                const reasoningDelta = deltaObj.reasoning_content || '';

                if (reasoningDelta) {
                    reasoningAccumulated += reasoningDelta;
                    if (!isThinking) {
                        isThinking = true;
                        status.textContent = '💭 Watching model think...';
                    }
                }

                if (contentDelta) {
                    accumulated += contentDelta;

                    if (isThinking) {
                        isThinking = false;
                        status.textContent = state.llmMode === 'shader' ? '✍️ Generating shader...' : '✍️ Generating response...';
                    }

                    if (!assistantMessageAdded && accumulated.trim() && state.llmMode !== 'shader') {
                        state.conversationHistory.push({ role: 'assistant', content: accumulated });
                        assistantMessageAdded = true;
                    }
                }

                if (reasoningDelta || contentDelta) {
                    if (assistantMessageAdded) {
                        state.conversationHistory[state.conversationHistory.length - 1].content = accumulated;
                    }
                    this._streamState = { accumulated, reasoningAccumulated };
                    this._scheduleStreamFlush();
                }
            } catch (e) {}
        };

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            pending += decoder.decode(value, { stream: true });
            const lines = pending.split('\n');
            pending = lines.pop() ?? '';
            for (const line of lines) {
                processLine(line);
            }
        }

        pending += decoder.decode();
        if (pending.trimEnd()) processLine(pending);
        
        const fullContent = reasoningAccumulated
            ? `<think>${reasoningAccumulated}</think>` + accumulated
            : accumulated;
        
        this._cancelStreamFlush();
        status.textContent = '✅ Complete';
        const retryInitiated = await this.processFinalResponse(fullContent, model, status);
        if (!retryInitiated) {
            this.abortController = null;
            this.setCancelMode(false);
        }
    },
    
    renderStreamingContent(content, isFinished) {
        const parts = ContentParser.parseContent(content);
        let html = '';
        
        for (const part of parts) {
            if (part.type === 'thinking') {
                const id = 'stream-think-' + Date.now();
                const isComplete = content.includes('</think>');
                if (isFinished && isComplete) {
                    html += Templates.thinkingBlock(part.content, id);
                } else {
                    html += `<div class="thinking-block">
                        <div class="thinking-label">${isComplete ? '💭 Thinking (complete)' : '💭 Thinking...'}</div>
                        <div class="thinking-content-block">${escapeHtml(part.content)}${!isComplete ? '<span class="cursor">|</span>' : ''}</div>
                    </div>`;
                }
            } else if (part.type === 'code') {
                html += Templates.codeBlock(part.content, `stream-code-${Math.random().toString(36).substr(2, 9)}`);
            } else {
                html += `<div class="msg-success">${escapeHtml(part.content)}${!isFinished ? '<span class="cursor">|</span>' : ''}</div>`;
            }
        }
        
        return html;
    },
    
    async processFinalResponse(content, model, status) {
        let displayAnswer = content.replace(/[\s\S]*?<\/think>/g, '').trim();
        if (displayAnswer.startsWith('<think>')) displayAnswer = displayAnswer.slice('<think>'.length).trim();

        const parts = ContentParser.parseContent(content);
        let responseHtml = `<strong>LM Studio (${escapeHtml(model)})</strong><br><br>`;

        let newShader = null;
        let parseError = null;
        if (state.llmMode === 'shader') {
            let candidate = displayAnswer;
            if (candidate.startsWith('<think>')) candidate = candidate.slice('<think>'.length).trim();
            try {
                const parsed = JSON.parse(candidate);
                if (parsed && typeof parsed.shader_code === 'string' && parsed.shader_code.trim()) {
                    newShader = parsed.shader_code.trim();
                } else {
                    parseError = 'missing shader_code field';
                }
            } catch (e) {
                const start = content.indexOf('{');
                const end = content.lastIndexOf('}');
                if (start !== -1 && end > start) {
                    try {
                        const parsed = JSON.parse(content.slice(start, end + 1));
                        if (parsed && typeof parsed.shader_code === 'string' && parsed.shader_code.trim()) {
                            newShader = parsed.shader_code.trim();
                        } else {
                            parseError = 'missing shader_code field';
                        }
                    } catch (e2) {
                        parseError = `invalid JSON — ${e2.message}`;
                    }
                } else {
                    parseError = `invalid JSON — ${e.message}`;
                }
            }
        }

        for (const part of parts) {
            if (part.type === 'thinking') {
                responseHtml += Templates.thinkingBlock(part.content, `final-think-${Math.random().toString(36).substr(2, 9)}`);
            } else if (state.llmMode === 'shader') {
                continue;
            } else if (part.type === 'code') {
                responseHtml += Templates.codeBlock(part.content, `final-code-${Math.random().toString(36).substr(2, 9)}`);
            } else {
                responseHtml += `<div class="msg-success">${escapeHtml(part.content)}</div>`;
            }
        }

        if (newShader) {
            responseHtml += Templates.codeBlock(newShader, `final-code-${Math.random().toString(36).substr(2, 9)}`);
            state.conversationHistory.push({ role: 'assistant', content: '```glsl\n' + newShader + '\n```' });
            Conversation.updateTokenCount();
        } else if (parseError) {
            responseHtml += `<div class="msg-error">Model returned ${escapeHtml(parseError)} — the endpoint may not enforce response_format.</div>`;
        }

        if (this._streamingEntry) {
            this._streamingEntry.innerHTML = responseHtml;
            this._streamingEntry.querySelectorAll('.tool-btn--success').forEach(btn => {
                btn.addEventListener('click', () => Conversation.loadCode(btn.dataset.code));
            });
            getEl('response').scrollTop = getEl('response').scrollHeight;
        } else {
            getEl('response').insertAdjacentHTML('beforeend', responseHtml);
        }

        if (state.llmMode === 'chat') {
            status.innerHTML = '✅ Response received.';
            return false;
        }

        if (!newShader) {
            status.innerHTML = '❌ Model returned an invalid response — no shader loaded.';
            return false;
        }

        const compileResult = WebGL.compileProgram(newShader, true);

        if (compileResult?.error) {
            if (this._fixRetries >= 5) {
                status.innerHTML = '❌ Shader compilation failed 5 times. Giving up — check the error above.';
                this._fixRetries = 0;
                return false;
            }
            this._fixRetries++;
            status.innerHTML = '❌ Shader compilation failed! Sending error back to model...';
            this.abortController = null;
            await this.send(false, `Compilation error:\n${compileResult.error}\n\nPlease fix this error and provide the complete corrected shader code.`);
            return true;
        } else {
            getEl('shaderCode').value = newShader;
            WebGL.initShader({ save: true });
            CodeDials.render();
            this._fixRetries = 0;

            status.innerHTML = '✅ Code received and loaded. <span class="status-highlight-green">Shader recompiled!</span>';
            return false;
        }
    }
};
