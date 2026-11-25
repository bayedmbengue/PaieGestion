'use strict';
// Pont sécurisé : l'interface n'a PAS accès à Node. Seuls ces canaux (liste blanche) sont appelables.
const { contextBridge, ipcRenderer } = require('electron');

const CHANNELS = new Set([
  'auth:status', 'auth:createAdmin', 'auth:login', 'auth:logout',
  'emp:list', 'emp:get', 'emp:save', 'emp:deactivate', 'emp:parts',
  'rub:list', 'rub:all', 'rub:save', 'emprub:list', 'emprub:save', 'emprub:close', 'emprub:delete',
  'per:get', 'per:open', 'per:close', 'var:list', 'var:save', 'var:delete',
  'paie:calculer', 'paie:journal', 'paie:detail', 'paie:pdf', 'paie:csv',
  'params:list', 'params:save', 'params:delete', 'ent:get', 'ent:save',
  'users:list', 'users:create', 'users:setActive', 'users:resetPassword',
  'cat:list', 'cat:save',
  'conge:types', 'conge:typeSave', 'conge:list', 'conge:jours', 'conge:save', 'conge:statut', 'conge:delete', 'conge:soldes', 'conge:soldeInit',
  'compta:ecritures', 'compta:reverser', 'compta:plan', 'compta:planSave', 'compta:rubriques', 'compta:rubSave', 'compta:params', 'compta:paramSave',
  'compta:csv', 'compta:virements',
  'rapport:filters', 'rapport:data', 'rapport:csv', 'rapport:pdf',
  'app:info', 'app:openSetup',
]);

contextBridge.exposeInMainWorld('paie', {
  call: (channel, ...args) => {
    if (!CHANNELS.has(channel)) return Promise.resolve({ ok: false, error: 'Canal non autorisé : ' + channel });
    return ipcRenderer.invoke(channel, ...args);
  },
  setup: {
    state: () => ipcRenderer.invoke('setup:state'),
    test: (cfg) => ipcRenderer.invoke('setup:test', cfg),
    save: (cfg) => ipcRenderer.invoke('setup:save', cfg),
  },
});
