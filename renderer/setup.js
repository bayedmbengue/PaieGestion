'use strict';
const $ = (id) => document.getElementById(id);
let hasPassword = false;
function msg(text, cls) { const m = $('msg'); m.textContent = text; m.className = cls; m.style.display = text ? 'block' : 'none'; }
function form() {
  return { server: $('server').value, port: $('port').value, instance: $('instance').value, database: $('database').value,
    authType: $('authType').value, user: $('user').value, password: $('password').value, domain: $('domain').value,
    encrypt: $('encrypt').checked, trustServerCertificate: $('trust').checked, keepPassword: hasPassword };
}
$('authType').onchange = () => { $('domWrap').style.display = $('authType').value === 'windows' ? '' : 'none'; };
function busy(b) { $('test').disabled = $('save').disabled = b; }
$('test').onclick = async () => {
  busy(true); msg('Test en cours…', 'info');
  const r = await window.paie.setup.test(form());
  busy(false);
  if (!r.ok) return msg(r.error, 'err');
  const st = { ready: 'La base existe et est prête.', 'no-schema': 'Serveur joignable, mais les tables de la paie sont absentes : exécutez PaieGestion_schema.sql dans SSMS.' }[r.state];
  msg('✓ Connexion réussie — ' + st + '\n' + r.version, 'ok');
};
$('save').onclick = async () => {
  busy(true); msg('Connexion à la base…', 'info');
  const r = await window.paie.setup.save(form());
  if (r && r.ok) return; // la fenêtre bascule vers l'application
  busy(false); msg((r && r.error) || 'Échec', 'err');
};
(async () => {
  const st = await window.paie.setup.state();
  const c = st.config; hasPassword = !!c.hasPassword;
  $('server').value = c.server; $('port').value = c.port; $('instance').value = c.instance; $('database').value = c.database;
  $('authType').value = c.authType; $('user').value = c.user; $('domain').value = c.domain;
  $('encrypt').checked = c.encrypt !== false; $('trust').checked = c.trustServerCertificate !== false;
  $('authType').onchange(); if (hasPassword) $('password').placeholder = '(inchangé)';
  if (st.error) msg(st.error, 'err');
})();
