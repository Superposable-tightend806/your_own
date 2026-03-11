/**
 * electron-builder configuration.
 * Run: npm run electron:build
 * Output goes to frontend/dist/
 */

module.exports = {
  appId: "com.yourown.app",
  productName: "Your Own",
  copyright: "AGPL-3.0",

  // Files to include in the app bundle
  files: [
    "electron/**/*",
    ".next/**/*",
    "public/**/*",
    "node_modules/**/*",
    "package.json",
    "next.config.mjs",
  ],

  // Extra resources bundled alongside the app (backend goes here)
  // extraResources: [
  //   { from: "../", to: "backend", filter: ["**/*", "!frontend/**", "!.git/**"] }
  // ],

  directories: {
    output: "dist",
    buildResources: "electron/assets",
  },

  // ── Platform targets ─────────────────────────────────────────────────────

  win: {
    target: [{ target: "nsis", arch: ["x64"] }],
    icon: "electron/assets/icon.ico",
  },

  mac: {
    target: [{ target: "dmg", arch: ["x64", "arm64"] }],
    icon: "electron/assets/icon.icns",
    category: "public.app-category.productivity",
  },

  linux: {
    target: [{ target: "AppImage", arch: ["x64"] }],
    icon: "electron/assets/icon.png",
    category: "Utility",
  },

  // ── Windows installer (NSIS) ──────────────────────────────────────────────

  nsis: {
    oneClick: true,
    perMachine: false,
    allowToChangeInstallationDirectory: false,
    deleteAppDataOnUninstall: false,
  },
};
