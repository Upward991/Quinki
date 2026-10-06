// ============================================================================
// quinki-wordmark.ts — ARCHIVIO ESATTO del wordmark pixel "Quinki" della CLI.
//
// L'utente (6 ott 2026) ha chiesto di TOLIERLO dalla CLI ma di tenerlo salvato
// per rimetterlo ESATTAMENTE UGUALE quando vorrà.
//
// ── COME RIPRISTINARLO (identico) ──────────────────────────────────────────
// 1. In cli/tui/app.ts, dove ora c'è:
//        const greet: string[] = []; // wordmark rimosso …
//    rimettere QUESTO blocco (dentro WelcomeRoot.render, dopo la riga
//    `const hintLines = ...`):
//
//      let greet: string[] = [];
//      try {
//        // Niente saluto (richiesta utente 6 ott): solo il nome in pixel/violet.
//        const plain = QEXPERT ? "App Expert" : "Quinki";
//        const boxW = boxLines.length > 0 ? Math.max(...boxLines.map((l: string) => visibleWidth(String(l)))) : width;
//        const hero = HERO_ART(); // big pixel word, one line
//        const heroW = Math.max(...hero.map((l) => visibleWidth(String(l))));
//        if (heroW + 4 <= width) {
//          const ref = heroW <= boxW ? boxW : width;
//          const off = Math.max(0, Math.floor((ref - heroW) / 2));
//          greet = hero.map((l) => " ".repeat(off) + l);
//        } else {
//          // FALLBACK terminal stretto: solo il nome, centrato sul text box.
//          const line = bold(fg(C.primary, plain));
//          const pad = " ".repeat(Math.max(0, Math.floor((boxW - visibleWidth(plain)) / 2)));
//          greet = ["", pad + line];
//        }
//      } catch {}
//
// 2. Sempre in cli/tui/app.ts, PRIMA di `class WelcomeRoot`, rimettere il
//    codice qui sotto (QPIX → HERO_ART), verbatim.
// 3. Ricompilare: bun build cli/main.ts --target=bun --outfile=/tmp/qc.js &&
//    bash scripts/build-cli.sh
//
// ── RENDER ESATTO (4 righe, per verifica) ─────────────────────────────────
// ▄▀▀▀▄        ▀        █     ▀
// █   █ █   █ ▀█  █▄▀▀▄ █ ▄▀ ▀█
// ▀▄▄▄▀ █  ▄█  █  █   █ █▀▄   █
//    █▄  ▀▀ ▀ ▀▀▀ ▀   ▀ ▀  ▀ ▀▀▀
//
// (per l'Expert: pixWord("App Expert") — nota: i glifi E/x/p/r NON esistono nel
//  QPIX → nell'Expert uscivano spazi in quelle lettere, quirk preesistente.)
// Colore: VIOLET = bold(fg(C.primary, …)) — il viola brand #9d8bd9.
//
// ── NELL'APP DESKTOP ──────────────────────────────────────────────────────
// La stessa scritta in versione web è in src/components/home/QuinkiWordmark.tsx
// (componente React, NON usato nella home: l'utente l'aveva fatta togliere).
// Anche quel file resta nel repo per riuso futuro.
// ============================================================================

// ===== CODICE ORIGINALE (copia VERBATIM da cli/tui/app.ts, stato 6 ott 2026) =====

const QPIX: Record<string, string[]> = {
  "W": ["10001", "10001", "10101", "10101", "10101", "11011", "10001", "00000"],
  "e": ["00000", "00000", "01110", "10001", "11111", "10000", "01110", "00000"],
  "l": ["01100", "00100", "00100", "00100", "00100", "00100", "01110", "00000"],
  "c": ["00000", "00000", "01110", "10001", "10000", "10001", "01110", "00000"],
  "o": ["00000", "00000", "01110", "10001", "10001", "10001", "01110", "00000"],
  "m": ["00000", "00000", "11011", "10101", "10101", "10101", "10101", "00000"],
  "t": ["00100", "00100", "01110", "00100", "00100", "00101", "00010", "00000"],
  " ": ["00000", "00000", "00000", "00000", "00000", "00000", "00000", "00000"],
  "Q": ["01110", "10001", "10001", "10001", "10001", "01110", "00010", "00011"],
  "u": ["00000", "00000", "10001", "10001", "10001", "10011", "01101", "00000"],
  "i": ["00100", "00000", "01100", "00100", "00100", "00100", "01110", "00000"],
  "n": ["00000", "00000", "10110", "11001", "10001", "10001", "10001", "00000"],
  "k": ["10000", "10000", "10010", "10100", "11000", "10100", "10010", "00000"],
  "!": ["01100", "01100", "01100", "01100", "00000", "01100", "00000", "00000"],
};
const glyphBounds = (bm: string[]): [number, number] => {
  let a = 99, b = -1;
  for (let r = 0; r < 8; r++) for (let x = 0; x < 5; x++) if (bm[r]?.[x] === "1") { a = Math.min(a, x); b = Math.max(b, x); }
  if (b < 0) return [0, 0];
  return [a, b];
};
const pixWord = (word: string, V: (t: string) => string): string[] => {
  const rows: string[] = [];
  for (let r = 0; r < 4; r++) {
    let out = "";
    for (let j = 0; j < word.length; j++) {
      if (word[j] === " ") { out += "   "; continue; } // FIXED word gap (symmetric between all words)
      const bm = QPIX[word[j]] || QPIX[" "];
      const [x0, x1] = glyphBounds(bm); // trim empty side columns -> even spacing
      for (let x = x0; x <= x1; x++) {
        const top = bm[r * 2]?.[x] === "1";
        const bot = bm[r * 2 + 1]?.[x] === "1";
        out += top && bot ? V("\u2588") : top ? V("\u2580") : bot ? V("\u2584") : " ";
      }
      if (j < word.length - 1) out += " ";
    }
    rows.push(out);
  }
  return rows;
};
const bigBrand = (): string[] => {
  // SOLO il nome (niente "Welcome to"): richiesta utente 6 ott.
  const VIOLET = (t: string) => bold(fg(C.primary, t));
  const b = pixWord(QEXPERT ? "App Expert" : "Quinki", VIOLET);
  return [b[0], b[1], b[2], b[3]];
};
const HERO_ART = (): string[] => {
  const brand = bigBrand();
  return [brand[0], brand[1], brand[2], brand[3], ""];
};

// NOTA: bold/fg/C/QEXPERT/visibleWidth sono già definiti in cli/tui/app.ts
// (helper del tema). Questo file è un ARCHIVIO: non viene importato.
export {}
