// Ambient declaration for the vendored webamp.min.mjs (ESM). Imported only
// from ui/webamp.js. Loose `any` typing for now; @types/webamp exists on
// DefinitelyTyped and can replace this once that file migrates to TS.

declare module '../../lib/webamp.min.mjs' {
    const Webamp: any;
    export default Webamp;
}

declare module '*.mjs' {
    const value: any;
    export default value;
}
