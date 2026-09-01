# File Explorer

File Explorer adds a compact workspace tree to a closable tab in a bb thread's
right panel. Folders load when expanded. Clicking a file opens BB's built-in
file preview.

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

The explorer shows hidden (dot) files and folders such as `.env`, `.git`, and
`.claude`. It still hides common generated directories: `node_modules`, `dist`,
`build`, `coverage`, `out`, `target`, `venv`, and `__pycache__`.

## Access model

The backend resolves the environment, host, and absolute workspace path from
the supplied thread ID on every directory request. The client supplies only a
workspace-relative directory. The backend rejects absolute paths, traversal,
backslashes, and generated-directory segments, then lists children through the
plugin host worker with `fs.readdir` so hidden names are included (BB's
`files.listPaths` omits them).

The plugin does not read file contents or write, rename, or delete files. File
opening uses BB's workspace preview target with the resolved environment ID.
