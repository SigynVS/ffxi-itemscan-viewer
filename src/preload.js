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
  openMapsFolder: () => ipcRenderer.invoke('map:openFolder'),
  getMapsDir: () => ipcRenderer.invoke('map:dir'),
  getConfigInfo: () => ipcRenderer.invoke('config:info'),
  browseAddonDir: () => ipcRenderer.invoke('config:browseAddonDir'),
  browseMapsDir: () => ipcRenderer.invoke('config:browseMapsDir'),
  getAddonConfig: () => ipcRenderer.invoke('addon:getConfig'),
  setAddonConfig: (cfg) => ipcRenderer.invoke('addon:setConfig', cfg),
  getRoeLabels: (character) => ipcRenderer.invoke('roe:labels', character),
  setRoeLabel: (character, id, name) =>
    ipcRenderer.invoke('roe:setLabel', { character, id, name }),
  getMissionLabels: (character) => ipcRenderer.invoke('mission:labels', character),
  setMissionLabel: (character, key, name) =>
    ipcRenderer.invoke('mission:setLabel', { character, key, name }),
  reloadAddon: () => ipcRenderer.invoke('addon:reload'),
  sendFeedback: (data) => ipcRenderer.invoke('feedback:send', data),
  onCharacters: (callback) => ipcRenderer.on('characters:update', (_event, data) => callback(data)),
  selectCharacter: (name) => ipcRenderer.invoke('character:select', name),
  hasMaps: () => ipcRenderer.invoke('map:hasMaps'),
  downloadMaps: () => ipcRenderer.invoke('map:download'),
  onMapProgress: (callback) => ipcRenderer.on('map:download-progress', (_event, data) => callback(data))
});
