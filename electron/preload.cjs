const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // プラットフォーム検出
  isElectron: true,

  // Whisper 統合
  transcribe: (audioBuffer, modelSize) =>
    ipcRenderer.invoke("whisper:transcribe", audioBuffer, modelSize),
  getWhisperModels: () => ipcRenderer.invoke("whisper:getModels"),
  getWhisperCacheDir: () => ipcRenderer.invoke("whisper:getCacheDir"),

  // デバイス列挙（将来: ネイティブ API 経由）
  getAudioDevices: () => ipcRenderer.invoke("audio:getDevices"),

  // アプリ情報
  getVersion: () => ipcRenderer.invoke("app:getVersion"),

  // 自動更新
  checkForUpdate: () => ipcRenderer.invoke("updater:check"),
  onUpdateAvailable: (callback) => ipcRenderer.on("update:available", (_e, version) => callback(version)),
  onUpdateDownloaded: (callback) => ipcRenderer.on("update:downloaded", (_e, version) => callback(version)),
});
