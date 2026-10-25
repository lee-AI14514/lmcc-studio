const { ipcMain } = require("electron");
const fs = require("fs");
const { readDirectory } = require("./scriptApi/readDirStructure.cjs");
const { getWorkspaceRoot } = require("./papers.js");
const apis = {
  init: () => {
    ipcMain.handle("fs:writeFile", async (e, ...args) =>
      fs.promises.writeFile(...args)
    );

    ipcMain.handle("fs:readFileSync", (e, ...args) => fs.readFileSync(...args));

    ipcMain.handle("fs:readdirStructure", async (event, data) => {
      return await readDirectory(data);
    });

 

    // The explorer opens the active paper folder from ~/.lmcc-studio, not the
    // application directory.
    ipcMain.handle("GetprojectPath", () => getWorkspaceRoot());
    
  },
};

module.exports = apis;
