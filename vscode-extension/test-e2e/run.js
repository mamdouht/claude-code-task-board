// Launches a real VS Code with this extension loaded and runs suite/index.js inside it.
// Run: npm run test:e2e   (downloads VS Code into .vscode-test/ on first run)
// Everything the extension reads is synthetic and lives in a temp dir; HOME is pointed at it too,
// so neither ~/.claude nor ~/.codex is touched.
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { runTests } = require("@vscode/test-electron");
const { writeFixtures } = require("./fixtures");

async function main() {
  // Inherited when launched from an Electron-based host (VS Code terminal, Claude Code); it makes
  // the VS Code binary run as plain Node and treat the workspace path as a script to load.
  delete process.env.ELECTRON_RUN_AS_NODE;
  // Short path: unix socket paths under user-data-dir are length-limited on macOS/Linux.
  const root = fs.mkdtempSync(path.join(fs.existsSync("/tmp") ? "/tmp" : os.tmpdir(), "tb-e2e-"));
  const home = path.join(root, "home");
  const userData = path.join(root, "ud");
  const workspace = path.join(root, "ws");
  for (const d of [home, workspace, path.join(userData, "User")]) fs.mkdirSync(d, { recursive: true });
  const fixtures = writeFixtures(root);
  fs.writeFileSync(
    path.join(userData, "User", "settings.json"),
    JSON.stringify({
      "claudeTasks.stateDir": fixtures.stateDir,
      "claudeTasks.codexSessionsDir": fixtures.codexDir,
      "claudeTasks.currentWorkspaceOnly": false,
      "security.workspace.trust.enabled": false,
      "update.mode": "none",
      "telemetry.telemetryLevel": "off",
    }),
  );
  try {
    await runTests({
      version: process.env.VSCODE_E2E_VERSION || "stable",
      extensionDevelopmentPath: path.resolve(__dirname, ".."),
      extensionTestsPath: path.resolve(__dirname, "suite", "index.js"),
      launchArgs: [workspace, "--user-data-dir", userData, "--extensions-dir", path.join(root, "ext"), "--disable-extensions", "--disable-gpu"],
      extensionTestsEnv: { HOME: home, USERPROFILE: home },
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("E2E failed:", err.message || err);
  process.exit(1);
});
