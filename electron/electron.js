const { app, globalShortcut } = require("electron");

const createWindow = require("./createWindow.js");
const { initSystemStats } = require("./systemStats.js");
const { registerLmccIpc } = require("./lmccFiles.js");
const { registerPapersIpc } = require("./papers.js");
const { registerEvaluationIpc } = require("./evaluation.js");
const setWatcher = require("./setChokidar.js");
app.once("ready", () => {
  //module load
  require("./apis.js").init();
  registerLmccIpc();
  registerPapersIpc();
  registerEvaluationIpc();
  initSystemStats();

  createWindow(1280, 720);

});

// 앱이 종료될 때 전역 단축키 등록을 해제.
app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
