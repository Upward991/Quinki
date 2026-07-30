// Shim per import.meta.url in CJS
const path = require('path');
const url = require('url');
const __filename_abs = __filename;
const __dirname_abs = __dirname;
// Definisci import.meta manualmente
globalThis.import = globalThis.import || {};
globalThis.import.meta = globalThis.import.meta || {};
globalThis.import.meta.url = url.pathToFileURL(__filename_abs).href;
globalThis.import.meta.dirname = __dirname_abs;
// Carica il bundle
require('./ws-bridge-bundle.cjs');
