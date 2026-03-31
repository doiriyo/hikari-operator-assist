const { app, BrowserWindow, ipcMain, systemPreferences, dialog } = require("electron");
const path = require("path");

const isDev = process.env.NODE_ENV === "development";

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Hikari Operator Assist",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:5173/hikari-oa/");
  } else {
    mainWindow.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

// ── 自動更新 ──
function setupAutoUpdater() {
  if (isDev) return; // 開発中は無効

  const { autoUpdater } = require("electron-updater");

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on("update-available", (info) => {
    console.log("[updater] 更新あり:", info.version);
    if (mainWindow) {
      mainWindow.webContents.send("update:available", info.version);
    }
  });

  autoUpdater.on("update-downloaded", (info) => {
    console.log("[updater] ダウンロード完了:", info.version);
    if (mainWindow) {
      mainWindow.webContents.send("update:downloaded", info.version);
    }
    dialog.showMessageBox(mainWindow, {
      type: "info",
      title: "アップデート",
      message: `新しいバージョン (${info.version}) がダウンロードされました。`,
      detail: "アプリを再起動すると更新が適用されます。",
      buttons: ["今すぐ再起動", "後で"],
      defaultId: 0,
    }).then(({ response }) => {
      if (response === 0) {
        autoUpdater.quitAndInstall();
      }
    });
  });

  autoUpdater.on("error", (err) => {
    console.error("[updater] エラー:", err.message);
  });

  // 起動後に更新チェック
  autoUpdater.checkForUpdatesAndNotify();
}

app.whenReady().then(async () => {
  if (process.platform === "darwin") {
    await systemPreferences.askForMediaAccess("microphone");
  }
  createWindow();
  setupAutoUpdater();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── IPC Handlers ──

ipcMain.handle("whisper:transcribe", async (_event, audioBuffer, modelSize) => {
  try {
    const { transcribeBuffer } = await import("./whisper.mjs");
    const text = await transcribeBuffer(audioBuffer, modelSize || "small");
    return { text, error: null };
  } catch (err) {
    console.error("[whisper] 文字起こしエラー:", err);
    return { text: "", error: err.message };
  }
});

ipcMain.handle("whisper:getModels", async () => {
  const { getAvailableModels } = await import("./whisper.mjs");
  return getAvailableModels();
});

ipcMain.handle("whisper:getCacheDir", async () => {
  const { getWhisperCacheDir } = await import("./whisper.mjs");
  return getWhisperCacheDir();
});

ipcMain.handle("audio:getDevices", async () => []);
ipcMain.handle("app:getVersion", () => app.getVersion());

ipcMain.handle("updater:check", async () => {
  if (isDev) return { updateAvailable: false };
  try {
    const { autoUpdater } = require("electron-updater");
    const result = await autoUpdater.checkForUpdates();
    return { updateAvailable: !!result?.updateInfo, version: result?.updateInfo?.version };
  } catch {
    return { updateAvailable: false };
  }
});
