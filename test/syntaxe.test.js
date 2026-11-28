'use strict';
// Garde-fou : un fichier de l'interface mal formé empêcherait toute l'application de s'afficher.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

for (const f of ['renderer/app.js', 'renderer/web-shim.js', 'preload.js']) {
  test(`${f} : syntaxe JavaScript valide`, () => {
    const p = path.join(__dirname, '..', f);
    if (!fs.existsSync(p)) return;
    assert.doesNotThrow(() => new vm.Script(fs.readFileSync(p, 'utf8'), { filename: f }));
  });
}
