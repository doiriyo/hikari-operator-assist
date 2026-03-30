// Electron起動ラッパー — ELECTRON_RUN_AS_NODE を削除してからelectronを起動
delete process.env.ELECTRON_RUN_AS_NODE;
const { execFileSync } = require("child_process");
const electronPath = require("electron");
try {
  execFileSync(electronPath, ["."], { stdio: "inherit", cwd: process.cwd() });
} catch (e) {
  process.exit(e.status || 1);
}
