import crypto from "node:crypto";
import fs from "node:fs";

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
    return {
      publicKey,
      privateKey,
      fingerprint: data.fingerprint,
      deviceToken: data.deviceToken ?? null,
    };
  }

  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");

  const derBuffer = publicKey.export({ type: "spki", format: "der" });
  const fingerprint = crypto.createHash("sha256").update(derBuffer).digest("hex");

  const identity = {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }),
    privateKeyPem: privateKey.export({ type: "pkcs8", format: "pem" }),
    fingerprint,
    deviceToken: null,
  };

  fs.writeFileSync(path, JSON.stringify(identity, null, 2), "utf-8");

  return { publicKey, privateKey, fingerprint, deviceToken: null };
}

/**
 * Sign a base64-encoded nonce with an Ed25519 private key.
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
