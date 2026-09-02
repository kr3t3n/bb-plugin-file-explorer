# File Explorer

File Explorer adds a compact workspace tree to a closable tab in a bb thread's
right panel. Folders load when expanded. Clicking a file opens an **Editor**
tab where you can change text and save (Ctrl/Cmd+S). A search box finds files
including hidden (dot) names that BB's built-in New Tab search skips.

## Install

From this checkout:

```sh
npm install
bb plugin install . --yes
bb plugin enable file-explorer
bb plugin reload file-explorer
```

From GitHub:

```sh
bb plugin install git:https://github.com/kr3t3n/bb-plugin-file-explorer.git --yes
bb plugin enable file-explorer
```

For development:

```sh
npm run typecheck
npm test
npm run build
```

## Use

Open a thread, create a right-panel tab, then choose **Files** under Actions.
You can also run **File Explorer: Open explorer** from the command palette.

Tree rows support Up, Down, Home, End, Enter, Left, and Right. The refresh
button clears the loaded tree and reads the current thread environment again.

Type in the search box to filter the workspace. Search includes hidden files
such as `.env` and `.gitignore`. It still skips generated directories:
`node_modules`, `dist`, `build`, `coverage`, `out`, `target`, `venv`, and
`__pycache__`.

Clicking a file opens the plugin **Editor** tab (not BB's read-only file
preview). Save with the Save button or Ctrl/Cmd+S. Reload if the file changed
on disk.

BB's built-in File Editor (`monaco-editor`) remains available from Settings →
Files / Open with on chat file links. This plugin uses its own editor because
plugin navigate cannot force the Monaco opener from the Files tree.

## Access model

The backend resolves the environment, host, and absolute workspace path from
the supplied thread ID on every directory, search, read, or write request. The
client supplies only a workspace-relative path or search query. The backend
rejects absolute paths, traversal, backslashes, and generated-directory
segments, then lists or searches through the plugin host worker with
`fs.readdir` so hidden names are included (BB's `files.listPaths` / New Tab
search omits them).

Reads and writes use `bb.sdk.files` with CAS (`expectedSha256`) so a stale
editor cannot overwrite newer disk content without a conflict.
