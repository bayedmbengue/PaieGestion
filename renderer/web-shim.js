'use strict';
/* Pont « navigateur » : remplace le pont sécurisé d'Electron quand l'application est ouverte depuis le serveur local.
   Dans Electron, window.paie existe déjà (preload) : ce fichier ne fait alors rien. */
(function () {
  if (window.paie) return;

  const post = async (url, body) => {
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}), credentials: 'same-origin' });
    return r.json();
  };

  /** Téléchargement d'un fichier (CSV…) : il arrive dans le dossier Téléchargements du navigateur. */
  const download = ({ name, mime, base64 }) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: mime || 'application/octet-stream' }));
    const a = document.createElement('a');
    a.href = url; a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  /** Bulletins : impression du document ; choisir « Enregistrer au format PDF » dans la fenêtre d'impression. */
  const printHtml = (html, name) => {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    f.onload = () => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 120000); };
    f.srcdoc = String(html).replace(/<title>.*?<\/title>/, `<title>${String(name || 'Bulletins').replace(/\.pdf$/i, '').replace(/[<>&"]/g, '')}</title>`);
    document.body.appendChild(f);
    if (typeof window.toast === 'function') window.toast("Fenêtre d'impression ouverte : choisissez « Enregistrer au format PDF ».");
  };

  window.paie = {
    call: async (channel, ...args) => {
      if (channel === 'app:openSetup') {
        const r = await post('/api/openSetup');
        if (r.ok) window.location.href = '/setup.html';
        return r;
      }
      const r = await post('/api/call', { channel, args });
      if (r.ok && r.data && r.data.download) { download(r.data.download); return { ok: true, data: { saved: true } }; }
      if (r.ok && r.data && r.data.printHtml) { printHtml(r.data.printHtml, r.data.name); return { ok: true, data: { saved: false } }; }
      return r;
    },
    setup: {
      state: () => post('/api/setup/state'),
      test: (cfg) => post('/api/setup/test', cfg),
      save: async (cfg) => {
        const r = await post('/api/setup/save', cfg);
        if (r && r.ok) window.location.href = '/index.html';
        return r;
      },
    },
  };

  // Signal de vie : quand la fenêtre est fermée, le serveur s'arrête tout seul
  const ping = () => fetch('/api/ping', { method: 'POST', credentials: 'same-origin' }).catch(() => {});
  ping();
  setInterval(ping, 4000);
})();
