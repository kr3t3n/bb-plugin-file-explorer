# File Explorer

File Explorer adds a compact workspace tree to a closable tab in a bb thread's
right panel. Folders load when expanded. Clicking a file opens BB's **File
Editor** (Monaco) so you can edit and save text files. A search box finds files
including hidden (dot) names that BB's built-in New Tab search skips.

## Install

From this checkout:

```sh
npm install
bb plugin install . --yes
bb plugin enable file-explorer
bb plugin reload file-explorer
```

Enable BB's File Editor as well (builtin):

```sh
bb plugin enable monaco-editor
```

From GitHub:

```sh
bb plugin install git:https://github.com/kr3t3n/bb-plugin-file-explorer.git --yes
bb plugin enable file-explorer
bb plugin enable monaco-editor
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

Clicking a file opens it with **File Editor** (`monaco-editor`). If that plugin
is disabled, BB falls back to the read-only preview.

## Access model

The backend resolves the environment, host, and absolute workspace path from
the supplied thread ID on every directory or search request. The client supplies
only a workspace-relative directory or a search query. The backend rejects
absolute paths, traversal, backslashes, and generated-directory segments, then
lists or searches through the plugin host worker with `fs.readdir` so hidden
names are included (BB's `files.listPaths` / New Tab search omits them).

The plugin does not read file contents or write, rename, or delete files. File
opening uses BB's workspace file-opener target with the File Editor viewer
override and the resolved environment ID.
