/**
 * Content Parser
 * Parses AI responses for thinking blocks and code blocks
 */

import { escapeHtml } from '../utils.js';

export const ContentParser = {
    /**
     * Extract thinking block from content
     * @param {string} content - Full content
     * @returns {{content: string, fullMatch: string}|null}
     */
    extractThinking(content) {
        const match = content.match(/([\s\S]*?)\u003c\/think>/);
        return match ? { content: match[1].trim(), fullMatch: match[0] } : null;
    },
    
    /**
     * Extract code blocks from content
     * @param {string} content - Full content
     * @returns {{code: string, index: number, length: number}[]}
     */
    extractCodeBlocks(content) {
        const blocks = [];
        const regex = /```(?:glsl)?\s*([\s\S]*?)```/g;
        let match;
        while ((match = regex.exec(content)) !== null) {
            blocks.push({ code: match[1].trim(), index: match.index, length: match[0].length });
        }
        return blocks;
    },
    
    /**
     * Parse content into parts (thinking, code, text)
     * @param {string} content - Full content
     * @returns {{type: string, content: string}[]}
     */
    parseContent(content) {
        const parts = [];
        const think = this.extractThinking(content);
        let remaining = content;
        
        if (think) {
            parts.push({ type: 'thinking', content: think.content });
            remaining = content.replace(think.fullMatch, '').trim();
        }
        
        const codeBlocks = this.extractCodeBlocks(remaining);
        let lastIndex = 0;
        
        for (const block of codeBlocks) {
            if (block.index > lastIndex) {
                const text = remaining.substring(lastIndex, block.index).trim();
                if (text) parts.push({ type: 'text', content: text });
            }
            parts.push({ type: 'code', content: block.code });
            lastIndex = block.index + block.length;
        }
        
        if (lastIndex < remaining.length) {
            const text = remaining.substring(lastIndex).trim();
            if (text) parts.push({ type: 'text', content: text });
        }
        
        return parts;
    }
};
