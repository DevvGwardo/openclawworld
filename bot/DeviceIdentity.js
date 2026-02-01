import crypto from "node:crypto";
import fs from "node:fs";

/** Ed25519 SPKI DER prefix (12 bytes) — strip to get raw 32-byte public key */
const ED25519_SPKI_PREFIX_LEN = 12;

/**
 * Derive device ID from a public key PEM — SHA-256 of the raw 32-byte key.
 * Matches the Gateway's deriveDeviceIdFromPublicKey().
 * @param {string} publicKeyPem
 * @returns {string} Hex-encoded SHA-256 fingerprint
 */
function deriveDeviceId(publicKeyPem) {
  const key = crypto.createPublicKey(publicKeyPem);
  const spki = key.export({ type: "spki", format: "der" });
  // Strip SPKI prefix to get raw 32-byte Ed25519 key
  const raw = spki.subarray(ED25519_SPKI_PREFIX_LEN);
  return crypto.createHash("sha256").update(raw).digest("hex");
}

/**
 * Load an existing Ed25519 identity from disk, or create a new one.
 * @param {string} path - File path for the JSON identity store
 * @returns {{ publicKey: crypto.KeyObject, privateKey: crypto.KeyObject, fingerprint: string, deviceToken: string|null }}
 */
export function loadOrCreateIdentity(path) {
  if (fs.existsSync(path)) {
    const data = JSON.parse(fs.readFileSync(path, "utf-8"));
    const publicKey = crypto.createPublicKey(data.publicKeyPem);
    const privateKey = crypto.createPrivateKey(data.privateKeyPem);
    // Re-derive fingerprint to ensure it matches Gateway's derivation
    const fingerprint = deriveDeviceId(data.publicKeyPem);
    return {
      publicKey,
      privateKey,
      fingerprint,
      deviceToken: data.deviceToken ?? null,
    };
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");

  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" });
  const fingerprint = deriveDeviceId(publicKeyPem);

  const identity = {
    publicKeyPem,
    privateKeyPem,
    fingerprint,
    deviceToken: null,
  };

  fs.writeFileSync(path, JSON.stringify(identity, null, 2), "utf-8");

  return { publicKey, privateKey, fingerprint, deviceToken: null };
}

/**
 * Build the structured payload string that the Gateway expects to be signed.
 * Format: "v2|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce"
 * @param {object} params
 * @returns {string}
 */
export function buildAuthPayload({ deviceId, clientId, clientMode, role, scopes, signedAtMs, token, nonce }) {
  const version = nonce ? "v2" : "v1";
  const base = [
    version,
    deviceId,
    clientId,
    clientMode,
    role,
    (scopes || []).join(","),
    String(signedAtMs),
    token || "",
  ];
  if (version === "v2") {
    base.push(nonce || "");
  }
  return base.join("|");
}

/**
 * Sign a payload string with an Ed25519 private key.
 * Returns base64url-encoded signature (matching Gateway's format).
 * @param {string} payload - UTF-8 string to sign
 * @param {crypto.KeyObject} privateKey - Ed25519 private key
 * @returns {string} Base64url-encoded signature
 */
export function signPayload(payload, privateKey) {
  const signature = crypto.sign(null, Buffer.from(payload, "utf-8"), privateKey);
  // Base64url encoding (matching Gateway's base64UrlEncode)
  return signature
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

/**
 * Sign a base64-encoded nonce with an Ed25519 private key.
 * @deprecated Use buildAuthPayload + signPayload instead
 * @param {string} nonce - Base64-encoded nonce
 * @param {crypto.KeyObject} privateKey - Ed25519 private key
 * @returns {string} Base64-encoded signature
 */
export function signChallenge(nonce, privateKey) {
  const nonceBuffer = Buffer.from(nonce, "base64");
  const signature = crypto.sign(null, nonceBuffer, privateKey);
  return signature.toString("base64");
}

/**
 * Persist the device token (and full identity) back to disk.
 * @param {string} path - File path for the JSON identity store
 * @param {{ publicKey: crypto.KeyObject, privateKey: crypto.KeyObject, fingerprint: string, deviceToken: string|null }} identity
 */
export function saveDeviceToken(path, identity) {
  const data = {
    publicKeyPem: identity.publicKey.export({ type: "spki", format: "pem" }),
    privateKeyPem: identity.privateKey.export({ type: "pkcs8", format: "pem" }),
    fingerprint: identity.fingerprint,
    deviceToken: identity.deviceToken,
  };
  fs.writeFileSync(path, JSON.stringify(data, null, 2), "utf-8");
}
