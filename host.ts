import fs from "node:fs/promises";
import path from "node:path";
import { experimental_defineHostEntry } from "@get-bb/plugin-sdk/host";
import { NOISE_DIRECTORY_NAMES } from "./constants.js";
import { hostContract } from "./contract.js";

const MAX_ENTRIES = 10_000;
const MAX_SEARCH_VISITS = 50_000;
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

function toPosixRelative(rootPath: string, absolutePath: string): string {
  return path.relative(rootPath, absolutePath).split(path.sep).join("/");
}

function scoreHit(query: string, relativePath: string, name: string): number {
  const q = query.toLowerCase();
  const pathLower = relativePath.toLowerCase();
  const nameLower = name.toLowerCase();
  if (nameLower === q) return 0;
  if (nameLower.startsWith(q)) return 1;
  if (nameLower.includes(q)) return 2;
  if (pathLower.startsWith(q)) return 3;
  if (pathLower.includes(q)) return 4;
  return 100;
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

    async searchPaths({ rootPath, query, limit }) {
      const root = path.resolve(rootPath);
      const needle = query.trim().toLowerCase();
      if (needle.length === 0) {
        return { hits: [], truncated: false };
      }

      type Hit = {
        kind: "directory" | "file";
        name: string;
        path: string;
        score: number;
      };
      const hits: Hit[] = [];
      let visits = 0;
      let truncated = false;

      const walk = async (absoluteDir: string): Promise<void> => {
        if (truncated) return;
        let dirents;
        try {
          dirents = await fs.readdir(absoluteDir, { withFileTypes: true });
        } catch {
          return;
        }

        for (const dirent of dirents) {
          if (truncated) return;
          if (dirent.name === "." || dirent.name === "..") continue;
          visits += 1;
          if (visits > MAX_SEARCH_VISITS) {
            truncated = true;
            return;
          }

          const childPath = path.join(absoluteDir, dirent.name);
          let kind: "directory" | "file" | null = null;
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

          if (kind === "directory" && NOISE_DIRECTORY_NAMES.has(dirent.name)) {
            continue;
          }

          const relativePath = toPosixRelative(root, childPath);
          if (relativePath.includes("\0")) continue;

          const score = scoreHit(needle, relativePath, dirent.name);
          if (score < 100) {
            hits.push({
              kind,
              name: dirent.name,
              path: relativePath,
              score,
            });
          }

          if (kind === "directory") {
            await walk(childPath);
          }
        }
      };

      await walk(root);

      hits.sort((left, right) => {
        if (left.score !== right.score) return left.score - right.score;
        if (left.kind !== right.kind) {
          return left.kind === "directory" ? -1 : 1;
        }
        return sortNames.compare(left.path, right.path);
      });

      const limited = hits.slice(0, limit).map(({ kind, name, path: hitPath }) => ({
        kind,
        name,
        path: hitPath,
      }));

      return {
        hits: limited,
        truncated: truncated || hits.length > limit,
      };
    },
  },
});
