'use strict';
const crypto = require('crypto');

const ITERATIONS = 210000;   // PBKDF2-HMAC-SHA512 (recommandation OWASP)
const KEYLEN = 64;

function hashPassword(password, salt = crypto.randomBytes(16), iterations = ITERATIONS) {
  const hash = crypto.pbkdf2Sync(String(password), salt, iterations, KEYLEN, 'sha512');
  return { hash, salt };
}

function verifyPassword(password, hash, salt, iterations = ITERATIONS) {
  if (!hash || !salt) return false;
  const h = crypto.pbkdf2Sync(String(password), salt, iterations, KEYLEN, 'sha512');
  return h.length === hash.length && crypto.timingSafeEqual(h, hash);
}

/** Blocage 30 s après 5 échecs consécutifs sur un même identifiant. */
class Throttle {
  constructor(maxFails = 5, lockMs = 30000, now = () => Date.now()) {
    this.maxFails = maxFails; this.lockMs = lockMs; this.now = now; this.map = new Map();
  }
  check(key) {
    const e = this.map.get(key);
    if (e && e.until > this.now()) {
      throw new Error(`Trop d'échecs de connexion. Réessayez dans ${Math.ceil((e.until - this.now()) / 1000)} s.`);
    }
  }
  fail(key) {
    const e = this.map.get(key) || { n: 0, until: 0 };
    e.n += 1;
    if (e.n >= this.maxFails) { e.until = this.now() + this.lockMs; e.n = 0; }
    this.map.set(key, e);
  }
  ok(key) { this.map.delete(key); }
}

module.exports = { hashPassword, verifyPassword, Throttle, ITERATIONS };
