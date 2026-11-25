'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { hashPassword, verifyPassword, Throttle } = require('../src/main/auth');

test('hachage PBKDF2 : bon mot de passe accepté, mauvais refusé', () => {
  const { hash, salt } = hashPassword('Secret-123', undefined, 1000);
  assert.ok(hash.length <= 128 && salt.length <= 32);   // tient dans VARBINARY(128) / VARBINARY(32)
  assert.equal(verifyPassword('Secret-123', hash, salt, 1000), true);
  assert.equal(verifyPassword('secret-123', hash, salt, 1000), false);
});

test('deux hachages du même mot de passe diffèrent (sel aléatoire)', () => {
  assert.notDeepEqual(hashPassword('abc', undefined, 1000).hash, hashPassword('abc', undefined, 1000).hash);
});

test('blocage 30 s après 5 échecs, puis déblocage', () => {
  let t = 0;
  const th = new Throttle(5, 30000, () => t);
  for (let i = 0; i < 5; i++) { th.check('bob'); th.fail('bob'); }
  assert.throws(() => th.check('bob'), /Trop d'échecs/);
  t = 31000;
  assert.doesNotThrow(() => th.check('bob'));
});
