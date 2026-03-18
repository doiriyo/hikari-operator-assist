const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // プラットフォーム検出
  isElectron: true,

  // Whisper 統合（将来実装）
  transcribe: (audioBuffer) =>
    ipcRenderer.invoke("whisper:transcribe", audioBuffer),

  // デバイス列挙（将来: ネイティブ API 経由）
  getAudioDevices: () => ipcRenderer.invoke("audio:getDevices"),

  // アプリ情報
  getVersion: () => ipcRenderer.invoke("app:getVersion"),
});
