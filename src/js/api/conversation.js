/**
 * Conversation Module
 * Manages chat history and message display
 */

import { state, getEl } from '../state.js';
import { AI_SHADER_BASE_PROMPT, AI_SYSTEM_PROMPT_ROLE } from '../config.js';
import { Templates } from '../utils/templates.js';
import { ContentParser } from '../utils/contentParser.js';
import { escapeHtml, estimateTokens } from '../utils.js';
import { CodeDials } from '../ui/codeDials.js';

export const Conversation = {
    add(role, content) {
        state.conversationHistory.push({ role, content });
        if (role === 'user') {
            const display = content === '[Analyze current shader state]'
                ? `<span class="msg-dimmed">${escapeHtml(content)}</span>`
                : escapeHtml(content);
            getEl('response').insertAdjacentHTML('beforeend', Templates.messageBubble(display, true, 'You'));
            getEl('response').scrollTop = getEl('response').scrollHeight;
        }
    },
    
    clear() {
        state.conversationHistory = [];
        const resp = getEl('response');
        if (resp) resp.innerHTML = '';
        this.updateTokenCount();
    },
    
    calculateTokens() {
        const shaderCode = getEl('shaderCode').value;
        const fullSystemPrompt = AI_SHADER_BASE_PROMPT + '\n\n' + AI_SYSTEM_PROMPT_ROLE.replace('[SEND_SHADER_CODE]', shaderCode);
        
        let total = estimateTokens(fullSystemPrompt) + 10;
        
        for (const msg of state.conversationHistory) {
            total += 10;
            if (msg.role === 'system') {
                total += estimateTokens(msg.content);
            } else if (msg.role === 'user') {
                if (typeof msg.content === 'string') {
                    total += estimateTokens(msg.content);
                } else if (Array.isArray(msg.content)) {
                    for (const item of msg.content) {
                        if (item.type === 'text') total += estimateTokens(item.text);
                        else if (item.type === 'image_url') total += 1000;
                    }
                }
            } else if (msg.role === 'assistant') {
                total += estimateTokens(msg.content);
            }
        }
        return total;
    },
    
    updateTokenCount() {
        const el = getEl('tokenCount');
        if (el) el.textContent = `≈ ${this.calculateTokens().toLocaleString()} tokens`;
    },
    
    loadCode(code) {
        if (confirm('Load this code into the shader editor? This will replace your current shader code.')) {
            getEl('shaderCode').value = code;
            // window.WebGL used to avoid circular dependency with core.js
            window.WebGL.initShader({ save: true });
            CodeDials.render();
            this.updateTokenCount();
            
            const status = getEl('status');
            status.innerHTML = '✅ Code loaded. <span class="status-highlight-green">Shader recompiled!</span>';
            setTimeout(() => status.textContent = '', 3000);
        }
    },
    
    render() {
    },
    
    renderAssistantMessage(content, index) {
        const parts = ContentParser.parseContent(content);
        let htmlContent = '';
        
        for (const part of parts) {
            if (part.type === 'thinking') {
                htmlContent += Templates.thinkingBlock(part.content, `think-${index}-${Math.random().toString(36).substr(2, 9)}`);
            } else if (part.type === 'code') {
                htmlContent += Templates.codeBlock(part.content, `code-${Math.random().toString(36).substr(2, 9)}`);
            } else {
                htmlContent += `<div class="status-highlight-green mb-2">${escapeHtml(part.content)}</div>`;
            }
        }
        
        return Templates.messageBubble(htmlContent, false, 'AI');
    }
};
