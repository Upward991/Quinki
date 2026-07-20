import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from "node:crypto";
import { hostname, userInfo, homedir } from "node:os";
import { platform, arch, cpus, totalmem } from "node:os";
import * as fs from "node:fs";

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;
const SALT_LEN = 16;
const SCRYPT_N = 16384;

let cachedKey: Buffer | null = null;
let cachedKeyLegacy: Buffer | null = null;
let cachedKeyV1: Buffer | null = null;

function getMachineFingerprint(): string {
  try {
    const parts = [
      hostname(),
      userInfo().username,
      platform(),
      arch(),
      homedir(),
    ];
    return parts.join("|");
  } catch {
    return "quinki-fallback-fingerprint";
  }
}

function getOrCreateSalt(): Buffer {
  const saltPath = `${process.env.QUINKI_AGENT_DIR || homedir() + "/.pi/agent"}/.quinki-salt`;
  // fs already imported at top
  if (fs.existsSync(saltPath)) {
    // === SICUREZZA: verifica integrità salt ===
    const existing = fs.readFileSync(saltPath);
    if (existing.length !== SALT_LEN) {
      console.warn("[crypto] salt file has wrong length, regenerating");
      fs.unlinkSync(saltPath);
    } else {
      return existing;
    }
  }
  const salt = randomBytes(SALT_LEN);
  fs.mkdirSync(require("path").dirname(saltPath), { recursive: true });
  fs.writeFileSync(saltPath, salt, { mode: 0o600 });
  try { fs.chmodSync(saltPath, 0o600); } catch {}
  return salt;
}

function deriveKey(): Buffer {
  if (cachedKey) return cachedKey;
  const salt = getOrCreateSalt();
  const fingerprint = getMachineFingerprint();
  // === NUOVA FORMULA (v2): con context hash "dashboard:v2:" ===
  const context = createHash("sha256").update("dashboard:v2:" + fingerprint).digest();
  cachedKey = scryptSync(context, salt, KEY_LEN, { N: SCRYPT_N });
  return cachedKey;
}

function deriveKeyV1(): Buffer {
  if (cachedKeyV1) return cachedKeyV1;
  const salt = getOrCreateSalt();
  const fingerprint = getMachineFingerprint();
  // === FORMULA INTERMEDIA (v1 con "dashboard:v1:") ===
  cachedKeyV1 = scryptSync(createHash("sha256").update("dashboard:v1:" + fingerprint).digest(), salt, KEY_LEN, { N: SCRYPT_N });
  return cachedKeyV1;
}

function deriveKeyLegacy(): Buffer {
  if (cachedKeyLegacy) return cachedKeyLegacy;
  const salt = getOrCreateSalt();
  const fingerprint = getMachineFingerprint();
  // === VECCHIA FORMULA: senza context hash ===
  cachedKeyLegacy = scryptSync(fingerprint, salt, KEY_LEN, { N: SCRYPT_N });
  return cachedKeyLegacy;
}

export function encryptString(plaintext: string): string {
  if (!plaintext) return "";
  const key = deriveKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([iv, tag, encrypted]);
  return `enc:v1:${combined.toString("base64")}`;
}

export function decryptString(payload: string): string {
  if (!payload) return "";
  if (!payload.startsWith("enc:v1:")) return payload;
  // === COMPATIBILITÀ: prova multiple varianti di key derivation ===
  // per garantire che le chiavi salvate con versioni precedenti siano ancora decifrabili.
  // 1. Chiave v2 (nuova, con context hash "dashboard:v2:")
  // 2. Chiave v1 (intermedia, con context hash "dashboard:v1:")
  // 3. Chiave legacy (vecchia, senza context hash)
  const variants: { name: string; getKey: () => Buffer }[] = [
    { name: "v2", getKey: deriveKey },
    { name: "v1", getKey: deriveKeyV1 },
    { name: "legacy", getKey: deriveKeyLegacy },
  ];
  for (const variant of variants) {
    try {
      const key = variant.getKey();
      const combined = Buffer.from(payload.substring(7), "base64");
      const iv = combined.subarray(0, IV_LEN);
      const tag = combined.subarray(IV_LEN, IV_LEN + 16);
      const encrypted = combined.subarray(IV_LEN + 16);
      const decipher = createDecipheriv(ALGO, key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
      const result = decrypted.toString("utf8");
      if (result) {
        if (variant.name !== "v2") {
          console.log(`[crypto] decrypted successfully with ${variant.name} key`);
        }
        return result;
      }
    } catch (e) {
      // Prova la prossima variante
    }
  }
  console.error("[crypto] decrypt failed with all key variants");
  return "";
}

export function isEncrypted(value: string): boolean {
  return typeof value === "string" && value.startsWith("enc:v1:");
}
