/**
 * LLM Module
 * Handles AI communication via LM Studio API
 */

import { state, getEl } from '../state.js';
import { AI_SHADER_BASE_PROMPT, AI_SYSTEM_PROMPT_ROLE, AI_CHAT_PROMPT_ROLE } from '../config.js';
import { Conversation } from './conversation.js';
import { ContentParser } from '../utils/contentParser.js';
import { Capture } from '../features/capture.js';
import { Templates } from '../utils/templates.js';
import { escapeHtml } from '../utils.js';
import { WebGL } from '../webgl/core.js';
import { CodeDials } from '../ui/codeDials.js';

export const LLM = {
    abortController: null,
    
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
            getEl('status').textContent = '❌ Request cancelled.';
        }
    },
    
    async send(includeImage = false, overrideMessage = null) {
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
        const roleTemplate = state.chatMode ? AI_CHAT_PROMPT_ROLE : AI_SYSTEM_PROMPT_ROLE;
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
        
        try {
            const res = await fetch('/api/chat/completions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    lm_studio_url: apiUrl,
                    bearer_key: bearerKey,
                    model: model,
                    messages: messages,
                    temperature: 0.7,
                    max_tokens: 100000,
                    stream: true
                }),
                signal: this.abortController.signal
            });
            
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
        this._streamingEntry = document.createElement('div');
        this._streamingEntry.className = 'response-entry';
        this._streamingEntry.innerHTML = `<strong>LM Studio (${escapeHtml(model)})</strong><br><br><div class="streaming-content"></div>`;
        getEl('response').appendChild(this._streamingEntry);
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const lines = decoder.decode(value, { stream: true }).split('\n');
            for (const line of lines) {
                if (!line.startsWith('data: ')) continue;
                const jsonStr = line.slice(6);
                if (jsonStr === '[DONE]') continue;
                
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
                            status.textContent = '✍️ Generating response...';
                        }
                        
                        if (!assistantMessageAdded && accumulated.trim()) {
                            state.conversationHistory.push({ role: 'assistant', content: accumulated });
                            assistantMessageAdded = true;
                        }
                    }
                    
                    if (reasoningDelta || contentDelta) {
                        const streamingDiv = this._streamingEntry?.querySelector('.streaming-content');
                        if (streamingDiv) {
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
                                displayHtml += this.renderStreamingContent(accumulated, false);
                            }
                            if (!accumulated && !reasoningAccumulated) {
                                displayHtml += '<span class="cursor">|</span>';
                            }
                            streamingDiv.innerHTML = displayHtml;
                        }
                        getEl('response').scrollTop = getEl('response').scrollHeight;

                        if (assistantMessageAdded) {
                            state.conversationHistory[state.conversationHistory.length - 1].content = accumulated;
                        }
                        Conversation.updateTokenCount();
                    }
                } catch (e) {}
            }
        }
        
        const fullContent = reasoningAccumulated
            ? `<think>${reasoningAccumulated}</think>` + accumulated
            : accumulated;
        
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
        const displayAnswer = content.replace(/[\s\S]*?<\/think>/g, '').trim();

        const parts = ContentParser.parseContent(content);
        let responseHtml = `<strong>LM Studio (${escapeHtml(model)})</strong><br><br>`;
        for (const part of parts) {
            if (part.type === 'thinking') {
                responseHtml += Templates.thinkingBlock(part.content, `final-think-${Math.random().toString(36).substr(2, 9)}`);
            } else if (part.type === 'code') {
                responseHtml += Templates.codeBlock(part.content, `final-code-${Math.random().toString(36).substr(2, 9)}`);
            } else {
                responseHtml += `<div class="msg-success">${escapeHtml(part.content)}</div>`;
            }
        }
        getEl('response');
        if (this._streamingEntry) {
            this._streamingEntry.innerHTML = responseHtml;
            this._streamingEntry.querySelectorAll('.tool-btn--success').forEach(btn => {
                btn.addEventListener('click', () => Conversation.loadCode(btn.dataset.code));
            });
            getEl('response').scrollTop = getEl('response').scrollHeight;
        } else {
            getEl('response').insertAdjacentHTML('beforeend', responseHtml);
        }

        if (state.chatMode) {
            status.innerHTML = '✅ Response received.';
            return false;
        } else {
            const shaderMatch = displayAnswer.match(/```(?:glsl)?\s*([\s\S]*?)```/);
            const newShader = shaderMatch ? shaderMatch[1].trim() : null;

            if (newShader) {
                const compileResult = WebGL.compileProgram(newShader, true);

                if (compileResult?.error) {
                    status.innerHTML = '❌ Shader compilation failed! Sending error back to model...';
                    this.abortController = null;
                    await this.send(false, `Compilation error:\n${compileResult.error}\n\nPlease fix this error and provide the complete corrected shader code.`);
                    return true;
                } else {
                    getEl('shaderCode').value = newShader;
                    WebGL.initShader({ save: true });
                    CodeDials.render();
                    Conversation.updateTokenCount();

                    status.innerHTML = '✅ Code received and loaded. <span class="status-highlight-green">Shader recompiled!</span>';
                    return false;
                }
            } else {
                status.innerHTML = '⚠️ No code block found.';
                return false;
            }
        }
    }
};
