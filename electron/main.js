import { app, BrowserWindow, ipcMain, systemPreferences } from "electron";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const isDev = process.env.NODE_ENV === "development";

function createWindow() {
  const win = new BrowserWindow({
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
    win.loadURL("http://localhost:5173/hikari-oa/");
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
  }
}

app.whenReady().then(async () => {
  // macOS: マイク権限をリクエスト
  if (process.platform === "darwin") {
    await systemPreferences.askForMediaAccess("microphone");
  }

  createWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ── IPC Handlers（whisper.cpp 統合用の基盤） ──

ipcMain.handle("whisper:transcribe", async (_event, _audioBuffer) => {
  return { text: "", segments: [] };
});

ipcMain.handle("audio:getDevices", async () => {
  return [];
});

ipcMain.handle("app:getVersion", () => {
  return app.getVersion();
});
