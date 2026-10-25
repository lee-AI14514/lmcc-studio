const { contextBridge, ipcRenderer } = require("electron");
window.ipcRenderer = require("electron").ipcRenderer;

contextBridge.exposeInMainWorld("electron", {
 //chokiWatcher 브릿지
 onFileChange: (callback) => {
  const listener = (event, ...args) => callback(...args);
  ipcRenderer.on('file-changed', listener);
  return () => ipcRenderer.removeListener('file-changed', listener);
 },
 startWatcher: (path) => ipcRenderer.send('start-watcher', path),
  
});
//system interface
contextBridge.exposeInMainWorld("system", {
  writeFile: async (...args) => ipcRenderer.invoke("fs:writeFile", ...args), //

  readFileSync: (...args) => ipcRenderer.invoke("fs:readFileSync", ...args), //

  getDirStructure: (...args) =>
    ipcRenderer.invoke("fs:readdirStructure", ...args), //

    GetprojectPath: () =>
    ipcRenderer.invoke("GetprojectPath"), //

  getStats: () => ipcRenderer.invoke("system:getStats"), //
});

// .lmcc question files: native picker, bounded reads, answer-file status,
// statement images and safe external links.
contextBridge.exposeInMainWorld("lmcc", {
  pickQuestionFile: () => ipcRenderer.invoke("lmcc:pick-file"),

  readSource: (filePath) => ipcRenderer.invoke("lmcc:read-source", filePath),

  readQuestionText: (root, rel, maxBytes) =>
    ipcRenderer.invoke("lmcc:read-text", { root, rel, maxBytes }),

  statQuestionPaths: (root, rels) =>
    ipcRenderer.invoke("lmcc:stat-paths", { root, rels }),

  readImage: (root, rel) =>
    ipcRenderer.invoke("lmcc:read-image", { root, rel }),

  openExternal: (url) => ipcRenderer.invoke("lmcc:open-external", url),

  // Local Python evaluation. Events are streamed on a separate channel while
  // the script runs; startEvaluation resolves with the run identity.
  startEvaluation: (payload) =>
    ipcRenderer.invoke("lmcc:evaluation-start", payload),

  stopEvaluation: (runId) =>
    ipcRenderer.invoke("lmcc:evaluation-stop", { runId }),

  onEvaluationEvent: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on("lmcc:evaluation-event", listener);
    return () =>
      ipcRenderer.removeListener("lmcc:evaluation-event", listener);
  },
});

// The paper library under ~/.lmcc-studio. Each immediate directory is a
// paper; list/activate re-scan the library on the main process.
contextBridge.exposeInMainWorld("papers", {
  list: () => ipcRenderer.invoke("papers:list"),

  activate: (id) => ipcRenderer.invoke("papers:activate", id),

  root: () => ipcRenderer.invoke("papers:root"),
});
