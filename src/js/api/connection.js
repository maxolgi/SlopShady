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

export function directConnectionHint(err) {
    return `Direct connection failed (${err.message}). If the API blocks browser access (CORS) or is on a LAN http:// address, switch Settings → Connection to "Via server relay".`;
}
