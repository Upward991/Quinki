const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const ASSETS = path.join(DIST, 'assets');
const SRC = path.join(ROOT, 'src-compiled');

// Clean dist
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(ASSETS, { recursive: true });

// Copy the working files
fs.copyFileSync(path.join(SRC, 'index-DTnRbIdn.js'), path.join(ASSETS, 'index-DTnRbIdn.js'));
fs.copyFileSync(path.join(SRC, 'index-Hpru02_U.css'), path.join(ASSETS, 'index-Hpru02_U.css'));
fs.copyFileSync(path.join(SRC, 'react-CHdo91hT.svg'), path.join(ASSETS, 'react-CHdo91hT.svg'));

// Write index.html
fs.writeFileSync(path.join(DIST, 'index.html'), `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="theme-color" content="#181920" />
    <link rel="icon" type="image/svg+xml" href="/assets/react-CHdo91hT.svg" />
    <link href="https://fonts.googleapis.com/css2?family=Geist:wght@100..900&family=Geist+Mono:wght@100..900&display=swap" rel="stylesheet" />
    <title></title>
    <style>
      input[type="checkbox"] {
        width: 18px !important;
        height: 18px !important;
        margin-right: 8px !important;
        cursor: pointer;
      }
    </style>
    <script type="module" crossorigin src="/assets/index-DTnRbIdn.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-Hpru02_U.css">
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>`);

console.log('✅ Build complete');
console.log('   JS:  ' + fs.statSync(path.join(ASSETS, 'index-DTnRbIdn.js')).size + ' bytes');
console.log('   CSS: ' + fs.statSync(path.join(ASSETS, 'index-Hpru02_U.css')).size + ' bytes');
