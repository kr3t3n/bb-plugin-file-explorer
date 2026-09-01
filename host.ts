import fs from "node:fs/promises";
import path from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { hostContract } from "./contract.js";

const MAX_ENTRIES = 10_000;
const sortNames = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

function assertInsideRoot(rootPath: string, absolutePath: string): string {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedPath = path.resolve(absolutePath);
  const relative = path.relative(resolvedRoot, resolvedPath);
  if (
    relative.startsWith("..") ||
    path.isAbsolute(relative) ||
    relative.includes("\0")
  ) {
    throw new Error("Directory is outside the workspace root");
  }
  return resolvedPath;
}

export default experimental_defineHostEntry({
  contract: hostContract,
  handlers: {
    async listDirectory({ path: absolutePath, rootPath }) {
      const target = assertInsideRoot(rootPath, absolutePath);
      const stat = await fs.stat(target);
      if (!stat.isDirectory()) {
        throw new Error("Path is not a directory");
      }

      const dirents = await fs.readdir(target, { withFileTypes: true });
      const entries: Array<{
        kind: "directory" | "file";
        name: string;
        path: string;
      }> = [];

      for (const dirent of dirents) {
        if (dirent.name === "." || dirent.name === "..") continue;

        let kind: "directory" | "file" | null = null;
        const childPath = path.join(target, dirent.name);
        if (dirent.isSymbolicLink()) {
          try {
            const linked = await fs.stat(childPath);
            kind = linked.isDirectory() ? "directory" : "file";
          } catch {
            continue;
          }
        } else if (dirent.isDirectory()) {
          kind = "directory";
        } else if (dirent.isFile()) {
          kind = "file";
        } else {
          continue;
        }

        entries.push({
          kind,
          name: dirent.name,
          path: childPath,
        });
        if (entries.length >= MAX_ENTRIES) break;
      }

      entries.sort((left, right) => {
        if (left.kind !== right.kind) {
          return left.kind === "directory" ? -1 : 1;
        }
        return sortNames.compare(left.name, right.name);
      });

      return {
        entries,
        truncated: dirents.length > entries.length,
      };
    },
  },
});
