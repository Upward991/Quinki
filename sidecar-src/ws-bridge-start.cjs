// CJS wrapper — provides __dirname for the bundled ESM code
const path = require('path');
const __dirname_val = __dirname;

// Patch import.meta for CJS
globalThis.__QUINKI_DIR = __dirname_val;

// Set env
process.env.QUINKI_AGENT_DIR = process.env.QUINKI_AGENT_DIR || (require('os').homedir() + '/.pi/agent-quinki-dev');

// Now require the bundled file
require('./ws-bridge-bundle.cjs');
