/**
 * The only bridge between the page and the machine.
 *
 * Node stays switched off in the renderer; what the app can do is exactly the
 * list below, and every one of those calls lands on a validating function in
 * repo.js. CommonJS because a sandboxed preload has no ESM loader.
 */

const { contextBridge, ipcRenderer } = require('electron');

const call = (name) => (...args) => ipcRenderer.invoke(`djtree:${name}`, ...args);

contextBridge.exposeInMainWorld('djtree', {
  graph: call('graph'),
  createTrack: call('createTrack'),
  updateTrack: call('updateTrack'),
  savePositions: call('savePositions'),
  deleteTrack: call('deleteTrack'),
  createTransition: call('createTransition'),
  updateTransition: call('updateTransition'),
  deleteTransition: call('deleteTransition'),
  createSetlist: call('createSetlist'),
  updateSetlist: call('updateSetlist'),
  deleteSetlist: call('deleteSetlist'),
  saveSetlistPositions: call('saveSetlistPositions'),
  resetSetlistPositions: call('resetSetlistPositions'),
  restore: call('restore'),
  importTracks: call('importTracks'),
  chooseFolder: call('chooseFolder'),
  revealLibrary: call('revealLibrary'),
  paths: call('paths'),
  updateCheck: call('updateCheck'),
  openLatestRelease: call('openLatestRelease'),

  /** Menu items the window has to act on, e.g. File → Add Music Folder. */
  onMenu: (handler) => {
    const listener = (_event, action) => handler(action);
    ipcRenderer.on('djtree:menu', listener);
    return () => ipcRenderer.removeListener('djtree:menu', listener);
  },
});
