/**
 * HTML Templates
 * Reusable HTML templates for UI components
 */

import { escapeHtml } from '../utils.js';

export const Templates = {
    /**
     * Thinking block template
     * @param {string} content - Thinking content
     * @param {string} id - Unique ID for the block
     * @returns {string} HTML string
     */
    thinkingBlock(content, id) {
        return `<div class="thinking-block">
            <div class="thinking-header" data-toggle="${id}">
                <span class="toggle-icon">▶</span>
                <span>💭 Thinking (click to expand)</span>
            </div>
            <div id="${id}" class="thinking-content">${escapeHtml(content)}</div>
        </div>`;
    },
    
    /**
     * Code block template
     * @param {string} code - Code content
     * @param {string} id - Unique ID for the block
     * @returns {string} HTML string
     */
    codeBlock(code, id) {
        const escapedCode = escapeHtml(code).replace(/"/g, '&quot;');
        return `<div class="code-block">
            <div class="code-block-header">
                <span data-toggle="${id}" class="template-clickable">
                    <span class="toggle-icon">▶</span> 📄 Code Block
                </span>
                <button class="tool-btn tool-btn--success" data-code="${escapedCode}">📥 Load</button>
            </div>
            <div id="${id}" class="code-block-content">${escapeHtml(code)}</div>
        </div>`;
    },
    
    /**
     * Message bubble template
     * @param {string} content - Message content
     * @param {boolean} isUser - Whether this is a user message
     * @param {string} label - Label text
     * @returns {string} HTML string
     */
    messageBubble(content, isUser, label) {
        const align = isUser ? 'right' : 'left';
        const cls = isUser ? 'msg-user' : 'msg-assistant';
        const alignClass = align === 'center' ? 'text-center' : align === 'right' ? 'text-right' : '';
        return `<div class="${alignClass} mt-2 mb-2">
            ${!isUser ? `<div class="msg-label">${label}</div>` : ''}
            <div class="${cls}">${content}</div>
            ${isUser ? `<div class="msg-label">${label}</div>` : ''}
        </div>`;
    },
    
    /**
     * Tuning log entry template
     * @param {string} message - Log message
     * @param {string} type - Log type (info, tool, result, error, finish)
     * @returns {string} HTML string
     */
    tuningLog(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        return `<div class="tuning-log ${type}">
            <span class="tuning-timestamp">[${timestamp}]</span> ${message}
        </div>`;
    }
};
