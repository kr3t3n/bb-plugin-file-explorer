/** Generated / cache dirs to hide. Dotfiles and other hidden names stay visible. */
export const NOISE_DIRECTORY_NAMES = new Set([
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
  "venv",
]);

/** @deprecated Use NOISE_DIRECTORY_NAMES. Kept for older imports in tests. */
export const HIDDEN_DIRECTORY_NAMES = NOISE_DIRECTORY_NAMES;

export const FILE_EDITOR_VIEWER = {
  pluginId: "monaco-editor",
  openerId: "monaco",
} as const;
