/**
 * LLM Connection
 * Shared helpers for talking to the OpenAI-compatible LLM API either
 * directly from the browser ("direct") or through the server relay
 * ("/api/..." proxy routes), per the Connection setting.
 */

import { getEl } from '../state.js';

export function getConnection() {
    const el = getEl('llmConnection');
    return el && el.value === 'relay' ? 'relay' : 'direct';
}

export function apiBase() {
    return getEl('apiUrl').value.trim().replace(/\/+$/, '');
}

export function authHeaders() {
    const key = getEl('bearerKey').value.trim();
    return key ? { 'Authorization': `Bearer ${key}` } : {};
}

export function thinkingParams() {
    const v = getEl('llmThinking')?.value;
    return v && v !== 'default' ? { reasoning_effort: v } : {};
}

export function directConnectionHint(err) {
    try {
        const u = new URL(apiBase());
        const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(u.hostname);
        if (window.location.protocol === 'https:' && u.protocol === 'http:' && !isLocal) {
            return `Direct connection failed (${err.message}). Plain-http APIs on another machine are blocked by the browser on this HTTPS page (mixed content). Allow insecure content for this site (padlock → Site settings → Insecure content → Allow), or switch Settings → Connection to "Via server relay".`;
        }
    } catch (e) {}
    return `Direct connection failed (${err.message}). If the API blocks browser access (CORS), switch Settings → Connection to "Via server relay".`;
}
