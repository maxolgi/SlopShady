// Loose ambient typing for the vendored litegraph.min.js (loaded as a global
// via <script> in slopshady.html). Tightened incrementally as files migrate
// to TS; for now `any` keeps allowJs + checkJs:false Pain-free.

declare global {
    interface Window {
        LiteGraph: any;
        LGraph: any;
        LGraphCanvas: any;
    }
    const LiteGraph: any;
    const LGraph: any;
    const LGraphCanvas: any;
}

export {};
