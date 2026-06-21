'use strict';

const { contextBridge, ipcRenderer } = require('electron');

// Minimal, explicit bridge. No nodeIntegration in the renderer.
contextBridge.exposeInMainWorld('itemscan', {
  onInventory: (callback) => {
    ipcRenderer.on('inventory:update', (_event, data) => callback(data));
  },
  onError: (callback) => {
    ipcRenderer.on('inventory:error', (_event, data) => callback(data));
  },
  onPosition: (callback) => {
    ipcRenderer.on('position:update', (_event, data) => callback(data));
  },
  fetchPrice: (itemId) => ipcRenderer.invoke('price:fetch', itemId),
  getCachedPrices: (itemIds) => ipcRenderer.invoke('price:cached', itemIds),
  setConcurrency: (n) => ipcRenderer.invoke('price:concurrency', n),
  openExternal: (url) => ipcRenderer.invoke('open:external', url),
  getRoeLabels: (character) => ipcRenderer.invoke('roe:labels', character),
  setRoeLabel: (character, id, name) =>
    ipcRenderer.invoke('roe:setLabel', { character, id, name })
});
