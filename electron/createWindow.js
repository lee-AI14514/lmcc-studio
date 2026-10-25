const { BrowserWindow, shell } = require('electron');
const path = require('path');

function isAppUrl(url) {
  try {
    const target = new URL(url);
    return (
      target.origin === 'http://127.0.0.1:3000' ||
      target.origin === 'http://localhost:3000'
    );
  } catch {
    return false;
  }
}

function openExternally(url) {
  if (/^(https?|mailto):/i.test(url)) {
    shell.openExternal(url).catch(() => {});
  }
}

async function createWindow(width, height) {
  //console.log(`window size : ${width}, ${height}`);
  const win = new BrowserWindow({
    width: width,
    height: height,
    title: 'LMCC Studio',
    backgroundColor: '#0b0c12',
    icon: path.join(__dirname, '..', 'public', 'icon.png'),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  // Never let a statement link take over the app window; open it in the
  // user's browser instead.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternally(url);
  });

 
    win.loadURL('http://127.0.0.1:3000');
    win.webContents.openDevTools({ mode: 'detach' });
  

  win.once('ready-to-show', () => {
    win.show();
  });
}

module.exports = createWindow;
