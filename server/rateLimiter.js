// Rate limiting, SSRF protection, and hashing utilities
// Extracted from index.js — pure functions, zero dependencies on server state

import crypto from "crypto";
import dns from "dns/promises";
import net from "net";

export const createRateLimiter = (maxRequests, windowMs) => {
  const hits = new Map();
  // Periodic cleanup every 60s
  setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now > entry.resetTime) hits.delete(key);
    }
  }, 60_000);
  return (key) => {
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || now > entry.resetTime) {
      entry = { count: 0, resetTime: now + windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    return entry.count > maxRequests;
  };
};

export const isValidWebhookUrl = (urlStr) => {
  let parsed;
  try { parsed = new URL(urlStr); } catch { return false; }
  if (parsed.protocol !== "https:") return false;
  if (parsed.port && parsed.port !== "443") return false;
  const hostname = parsed.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) return false;
  // Block IPv6 loopback/private
  if (hostname === "[::1]" || hostname.startsWith("[fe80") || hostname.startsWith("[fc") || hostname.startsWith("[fd")) return false;
  // Block private IPv4 ranges
  const ipv4Match = hostname.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (ipv4Match) {
    const [, a, b] = ipv4Match.map(Number);
    if (a === 127 || a === 10 || a === 0) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 169 && b === 254) return false;
  }
  return true;
};

const isPrivateIpAddress = (address) => {
  if (typeof address !== "string" || address.length === 0) return true;
  const normalized = address.toLowerCase();

  // Handle IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1)
  if (normalized.startsWith("::ffff:")) {
    return isPrivateIpAddress(normalized.slice(7));
  }

  if (net.isIPv4(normalized)) {
    const octets = normalized.split(".").map(Number);
    const a = octets[0];
    const b = octets[1];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }

  if (net.isIPv6(normalized)) {
    if (normalized === "::1") return true; // loopback
    if (normalized.startsWith("fe8") || normalized.startsWith("fe9") || normalized.startsWith("fea") || normalized.startsWith("feb")) return true; // link-local fe80::/10
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true; // unique local fc00::/7
    return false;
  }

  return true;
};

export const isSafeWebhookUrl = async (urlStr) => {
  if (!isValidWebhookUrl(urlStr)) return false;

  let parsed;
  try {
    parsed = new URL(urlStr);
  } catch {
    return false;
  }

  const hostname = parsed.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (isPrivateIpAddress(hostname)) return false;

  // Resolve DNS and block hostnames that resolve to private/internal addresses.
  // This reduces SSRF bypasses via DNS rebinding and private DNS records.
  try {
    const resolved = await dns.lookup(hostname, { all: true, verbatim: true });
    if (!Array.isArray(resolved) || resolved.length === 0) return false;
    return resolved.every((entry) => !isPrivateIpAddress(entry.address));
  } catch {
    return false;
  }
};

export const hashApiKey = (key) => crypto.createHash("sha256").update(key).digest("hex");
