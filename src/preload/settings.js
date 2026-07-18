'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const LISTEN_CHANNELS = ['settings-changed', 'goto-tab', 'history-changed', 'edit-latest'];

contextBridge.exposeInMainWorld('murmur', {
  on(channel, cb) {
    if (!LISTEN_CHANNELS.includes(channel)) return;
    ipcRenderer.on(channel, (e, payload) => cb(payload));
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setSettings: (partial) => ipcRenderer.invoke('settings:set', partial),
  testConnection: () => ipcRenderer.invoke('connection:test'),
  listModels: () => ipcRenderer.invoke('models:list'),
  captureHoldKey: () => ipcRenderer.invoke('hold:capture'),
  historyList: () => ipcRenderer.invoke('history:list'),
  historyUpdate: (id, text) => ipcRenderer.invoke('history:update', id, text),
  historyDelete: (id) => ipcRenderer.invoke('history:delete', id),
  historyClear: () => ipcRenderer.invoke('history:clear'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  testDictation: () => ipcRenderer.send('dictation:test'),
});
