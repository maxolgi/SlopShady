// Loose ambient typing for the vendored butterchurn.min.js (loaded as a
// global via <script defer> in slopshady.html). Used by features/milkdrop.js.

declare global {
    interface Window {
        butterchurn: any;
    }
    const butterchurn: any;
}

export {};
