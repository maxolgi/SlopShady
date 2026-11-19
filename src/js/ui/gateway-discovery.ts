/**
 * Gateway discovery: cert hash + WT port from the gateway's cert-hash.js.
 *
 * Two paths, same data: the backend proxy (accepts the self-signed cert
 * server-side) first, then a direct browser fetch — split-routing
 * deployments where the browser can reach the gateway but the backend
 * cannot need the second path. The direct path requires the gateway to
 * send CORS headers on cert-hash.js.
 */

export interface GatewayDiscovery {
    hash: string | null;
    wtPort: number | null;
}

function parseCertHashJs(text: string): GatewayDiscovery {
    const h = text.match(/CERT_HASH\s*=\s*"([0-9a-fA-F]+)"/);
    const p = text.match(/WT_PORT\s*=\s*(\d+)/);
    return { hash: h ? h[1] : null, wtPort: p ? parseInt(p[1], 10) : null };
}

export async function discoverGateway(webUrl: string): Promise<GatewayDiscovery> {
    let proxyErr = 'not attempted';
    try {
        const resp = await fetch('/api/stream/cert-hash?url=' + encodeURIComponent(webUrl), { cache: 'no-store' });
        if (!resp.ok) throw new Error('proxy HTTP ' + resp.status);
        const j = await resp.json();
        if (j.error) throw new Error(String(j.error));
        return { hash: j.hash ?? null, wtPort: j.wtPort ?? null };
    } catch (e) {
        proxyErr = (e && (e as Error).message) || String(e);
    }
    try {
        const resp = await fetch(new URL('/cert-hash.js', webUrl).href, { cache: 'no-store' });
        if (!resp.ok) throw new Error('gateway HTTP ' + resp.status);
        const parsed = parseCertHashJs(await resp.text());
        console.info('gateway discovery via direct browser fetch (backend proxy failed: ' + proxyErr + ')');
        return parsed;
    } catch (e) {
        const directErr = (e && (e as Error).message) || String(e);
        throw new Error(
            'backend proxy: ' + proxyErr + ' · direct browser fetch: ' + directErr +
            ' — the SlopShady backend needs a route to the gateway, or the gateway must allow CORS on cert-hash.js');
    }
}
