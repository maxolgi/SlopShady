/**
 * Factory Content Browser
 * Browse and load factory shader content
 */

import { state, getEl } from '../state.js';
import { escapeHtml } from '../utils.js';

export const ContentBrowser = {
    _manifest: null,

    async init() {
        await this.fetchManifest();
        this.render();
        this._bindEvents();
        document.dispatchEvent(new CustomEvent('factory-shaders-loaded'));
    },

    async fetchManifest() {
        try {
            const resp = await fetch('/static/content/manifest.json');
            if (!resp.ok) throw new Error('HTTP ' + resp.status);
            this._manifest = await resp.json();
        } catch (e) {
            this._manifest = { shaders: [] };
        }
    },

    async getShaderCode(id) {
        const entry = this._manifest?.shaders?.find(s => s.id === id);
        if (!entry) return null;
        try {
            const resp = await fetch(`/static/content/shaders/factory/${entry.file}`);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            return await resp.text();
        } catch (e) {
            return null;
        }
    },

    getFactoryEntry(id) {
        return this._manifest?.shaders?.find(s => s.id === id) || null;
    },

    async loadShader(id) {
        const entry = this._manifest.shaders.find(s => s.id === id);
        if (!entry) {
            const status = getEl('status');
            if (status) status.textContent = 'Shader not found in manifest';
            return;
        }

        try {
            const code = await this.getShaderCode(id);
            if (!code) return;

            // Load into editor — same path as Shaders.load()
            getEl('shaderCode').value = code;
            state.currentShaderId = null;
            if (window.WebGL) window.WebGL.initShader();
            if (window.CodeDials) window.CodeDials.render();
            if (window.Conversation) window.Conversation.updateTokenCount();

            const status = getEl('status');
            if (status) status.textContent = `Loaded: ${entry.name}`;
            setTimeout(() => { if (status) status.textContent = ''; }, 3000);
        } catch (e) {
        }
    },

    render() {
        const container = getEl('factoryShadersList');
        if (!container) return;

        if (!this._manifest || !this._manifest.shaders.length) {
            container.innerHTML = '<div class="section-subheader empty-placeholder p-3">No factory shaders available.</div>';
            return;
        }

        const shaders = this._manifest.shaders;
        const countEl = getEl('factoryShaderCount');
        if (countEl) countEl.textContent = `${shaders.length} shaders`;

        let html = '';
        for (const s of shaders) {
            const tags = s.tags ? s.tags.map(t => `<span class="factory-tag">${escapeHtml(t)}</span>`).join('') : '';
            html += `<div class="factory-shader-item" data-shader-id="${escapeHtml(s.id)}">
                <span class="factory-shader-name">${escapeHtml(s.name)}</span>
                <div class="factory-shader-desc">${escapeHtml(s.description || '')}</div>
                ${tags ? '<div class="factory-shader-tags">' + tags + '</div>' : ''}
            </div>`;
        }
        container.innerHTML = html;
    },

    _bindEvents() {
        const container = getEl('factoryShadersList');
        if (!container) return;

        container.addEventListener('click', (e) => {
            const item = e.target.closest('.factory-shader-item');
            if (item) {
                this.loadShader(item.dataset.shaderId);
            }
        });
    }
};
