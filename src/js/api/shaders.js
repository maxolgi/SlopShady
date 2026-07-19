/**
 * Shaders Module
 * Manages saved shader collection
 */

import { state, getEl } from '../state.js';
import { Sync } from '../features/sync.js';
import { escapeHtml } from '../utils.js';
import { CodeDials } from '../ui/codeDials.js';
import { Conversation } from './conversation.js';

export const Shaders = {
    _notifyChanged() {
        document.dispatchEvent(new CustomEvent('shaders-changed'));
    },

    init(data) {
        if (data && Array.isArray(data)) {
            state.savedShaders = data;
        }

        const container = getEl('shadersList');
        if (container) {
            container.addEventListener('click', (e) => {
                const item = e.target.closest('.shader-item');
                if (!item) return;
                this.load(item.dataset.shaderId);
            });
        }

        this.render();
        this._notifyChanged();
    },

    save(code) {
        if (!code || !code.trim()) return;

        const trimmedCode = code.trim();
        const exists = state.savedShaders.some(s => s.code.trim() === trimmedCode);
        if (exists) return;

        const shader = {
            id: Date.now().toString(36) + Math.random().toString(36).substr(2, 5),
            name: this.generateName(code),
            code: code,
            timestamp: new Date().toISOString()
        };

        state.savedShaders.push(shader);
        state.currentShaderId = shader.id;
        this.render();
        this._notifyChanged();
        Sync.send({ savedShaders: state.savedShaders, currentShaderId: state.currentShaderId });

        console.log('%c💾 Shader saved: ' + shader.name, 'color:#0f0');
    },

    generateName(code) {
        const titleMatch = code.match(/\/\/\s*(.+)/);
        if (titleMatch) {
            const title = titleMatch[1].trim().replace(/^name:\s*/i, '');
            if (title.length > 0 && title.length < 50) return title;
        }
        const now = new Date();
        return `Shader ${now.toLocaleDateString()} ${now.toLocaleTimeString()}`;
    },

    load(id) {
        const shader = state.savedShaders.find(s => s.id === id);
        if (!shader) return;

        getEl('shaderCode').value = shader.code;
        state.currentShaderId = id;
        
        // window.WebGL used to avoid circular dependency with core.js
        window.WebGL.initShader();
        CodeDials.render();
        Conversation.updateTokenCount();
        
        this.render();
        Sync.send({ currentShaderId: id });

        const status = getEl('status');
        status.innerHTML = `✅ Loaded "${escapeHtml(shader.name)}"`;
        setTimeout(() => status.textContent = '', 3000);
    },

    delete(id) {
        state.savedShaders = state.savedShaders.filter(s => s.id !== id);
        Sync.send({ savedShaders: state.savedShaders });
        this.render();
        this._notifyChanged();
    },

    exportToJSON() {
        return JSON.stringify(state.savedShaders, null, 2);
    },

    importFromJSON(json) {
        try {
            const data = JSON.parse(json);
            if (Array.isArray(data)) {
                state.savedShaders = data;
                Sync.send({ savedShaders: state.savedShaders });
                this.render();
                this._notifyChanged();
                return true;
            }
        } catch (e) {
            console.error('Failed to import shaders:', e);
        }
        return false;
    },

    render() {
        const container = getEl('shadersList');
        const countEl = getEl('shaderCount');
        if (!container) return;
        
        countEl.textContent = `${state.savedShaders.length} shader${state.savedShaders.length !== 1 ? 's' : ''} saved`;
        
        if (state.savedShaders.length === 0) {
            container.innerHTML = '<div class="text-center text-muted p-3 empty-placeholder">No shaders saved yet. Successfully compiled shaders will appear here.</div>';
            return;
        }
        
        let html = '';
        state.savedShaders.forEach(shader => {
            const date = new Date(shader.timestamp);
            const dateStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            const preview = shader.code.substring(0, 100).replace(/\n/g, ' ');
            const isCurrent = shader.id === state.currentShaderId;
            const itemClass = isCurrent ? 'shader-item shader-item--current' : 'shader-item';
            const indicator = isCurrent ? '<span class="status-highlight-green shader-item-indicator">▶</span>' : '';

            html += `
                <div class="${itemClass}" data-shader-id="${shader.id}">
                    <div class="shader-item-details">
                        <span class="shader-item-name ${isCurrent ? 'shader-item-name--current' : 'shader-item-name--saved'}">${indicator}${escapeHtml(shader.name)}</span>
                    </div>
                    <div class="shader-item-date">${dateStr}</div>
                    <div class="shader-item-preview">${escapeHtml(preview)}...</div>
                </div>
            `;
        });
        
        container.innerHTML = html;
    }
};
