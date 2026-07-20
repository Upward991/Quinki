// Patch import.meta for CJS
const path = require('path');
const url = require('url');
const __dirname_val = __dirname;
const __filename_val = __filename;

// Provide import.meta.url equivalent
process.env.__QUINKI_DIR = __dirname_val;

// Monkey-patch fileURLToPath to use __filename when url is undefined
const originalFileURLToPath = url.fileURLToPath;
url.fileURLToPath = function(input) {
  if (input === undefined || input === null) {
    return __filename_val;
  }
  if (typeof input === 'string') {
    return input;
  }
  try {
    return originalFileURLToPath(input);
  } catch {
    return __filename_val;
  }
};

// Now load the bundled sidecar
require('./sidecar-bundle.cjs');
