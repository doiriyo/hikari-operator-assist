import * as electron from "electron/main";
const { app, BrowserWindow, ipcMain, systemPreferences } = electron;
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

// ── IPC Handlers ──

ipcMain.handle("whisper:transcribe", async (_event, audioBuffer) => {
  try {
    const { transcribeBuffer } = await import("./whisper.mjs");
    const text = await transcribeBuffer(audioBuffer);
    return { text, error: null };
  } catch (err) {
    console.error("[whisper] 文字起こしエラー:", err);
    return { text: "", error: err.message };
  }
});

ipcMain.handle("audio:getDevices", async () => []);
ipcMain.handle("app:getVersion", () => app.getVersion());
