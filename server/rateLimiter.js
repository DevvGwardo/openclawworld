// Rate limiting, SSRF protection, and hashing utilities
// Extracted from index.js — pure functions, zero dependencies on server state

import crypto from "crypto";

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

export const hashApiKey = (key) => crypto.createHash("sha256").update(key).digest("hex");
