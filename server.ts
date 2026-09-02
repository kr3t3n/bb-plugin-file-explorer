import path from "node:path";
import { defineRpcContract, type BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import {
  HIDDEN_DIRECTORY_NAMES,
  NOISE_DIRECTORY_NAMES,
} from "./constants.js";
import { hostContract } from "./contract.js";

export { HIDDEN_DIRECTORY_NAMES, NOISE_DIRECTORY_NAMES };

const explorerContextSchema = z.object({
  environmentId: z.string(),
  hostId: z.string(),
  rootName: z.string(),
  rootPath: z.string(),
});

const explorerEntrySchema = z.object({
  kind: z.enum(["directory", "file"]),
  name: z.string(),
  path: z.string(),
});

const threadInputSchema = z.object({
  threadId: z.string().trim().min(1),
});

const listChildrenInputSchema = threadInputSchema.extend({
  relativeDir: z.string().max(4096),
});

const searchFilesInputSchema = threadInputSchema.extend({
  query: z.string().trim().min(1).max(256),
  limit: z.number().int().positive().max(500).optional(),
});

const fileTargetInputSchema = threadInputSchema.extend({
  path: z.string().min(1).max(4096),
});

const writeTextFileInputSchema = fileTargetInputSchema.extend({
  content: z.string(),
  expectedSha256: z.string().min(1),
});

export const rpcContract = defineRpcContract({
  getExplorerContext: {
    input: threadInputSchema,
    output: explorerContextSchema,
  },
  listChildren: {
    input: listChildrenInputSchema,
    output: z.object({
      context: explorerContextSchema,
      entries: z.array(explorerEntrySchema),
      truncated: z.boolean(),
    }),
  },
  searchFiles: {
    input: searchFilesInputSchema,
    output: z.object({
      context: explorerContextSchema,
      hits: z.array(explorerEntrySchema),
      truncated: z.boolean(),
    }),
  },
  readTextFile: {
    input: fileTargetInputSchema,
    output: z.discriminatedUnion("kind", [
      z.object({
        kind: z.literal("text"),
        content: z.string(),
        sha256: z.string(),
        absolutePath: z.string(),
      }),
      z.object({
        kind: z.literal("unsupported"),
        reason: z.string(),
      }),
    ]),
  },
  writeTextFile: {
    input: writeTextFileInputSchema,
    output: z.discriminatedUnion("outcome", [
      z.object({
        outcome: z.literal("written"),
        sha256: z.string(),
      }),
      z.object({
        outcome: z.literal("conflict"),
        currentSha256: z.string().nullable(),
      }),
    ]),
  },
});

export type ExplorerContext = z.infer<typeof explorerContextSchema>;
export type ExplorerEntry = z.infer<typeof explorerEntrySchema>;

const sortNames = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: "base",
});

/**
 * Accept only canonical workspace-relative directories. The browser cannot
 * select a host, an absolute path, or a sibling of the environment root.
 */
export function normalizeRelativeDirectory(value: string): string {
  if (value === "") return "";
  if (
    value.includes("\0") ||
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[A-Za-z]:/.test(value)
  ) {
    throw new Error("Directory must be a workspace-relative path");
  }

  const segments = value.split("/");
  if (
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        NOISE_DIRECTORY_NAMES.has(segment),
    )
  ) {
    throw new Error("Directory is outside the browsable workspace tree");
  }
  return segments.join("/");
}

/** Same confinement as directories, but empty paths are rejected. */
export function normalizeRelativeFilePath(value: string): string {
  if (value === "") {
    throw new Error("File path is required");
  }
  return normalizeRelativeDirectory(value);
}

const MAX_EDITABLE_BYTES = 8 * 1024 * 1024;

function rootName(rootPath: string): string {
  const withoutTrailingSeparators = rootPath.replace(/[\\/]+$/, "");
  const parsed =
    /^[A-Za-z]:[\\/]/.test(withoutTrailingSeparators) ||
    withoutTrailingSeparators.includes("\\")
      ? path.win32
      : path.posix;
  return parsed.basename(withoutTrailingSeparators) || rootPath;
}

export function joinWorkspacePath(
  rootPath: string,
  relativeDir: string,
): string {
  if (relativeDir === "") return rootPath;
  const parsed =
    /^[A-Za-z]:[\\/]/.test(rootPath) || rootPath.includes("\\")
      ? path.win32
      : path.posix;
  return parsed.join(rootPath, ...relativeDir.split("/"));
}

export function projectExplorerEntries(
  relativeDir: string,
  absoluteRoot: string,
  hostEntries: readonly {
    kind: "directory" | "file";
    name: string;
    path: string;
  }[],
): ExplorerEntry[] {
  const byName = new Map<string, ExplorerEntry>();
  const parsed =
    /^[A-Za-z]:[\\/]/.test(absoluteRoot) || absoluteRoot.includes("\\")
      ? path.win32
      : path.posix;

  for (const candidate of hostEntries) {
    if (
      candidate.name.includes("/") ||
      candidate.name.includes("\\") ||
      candidate.name === "." ||
      candidate.name === ".." ||
      (candidate.kind === "directory" &&
        NOISE_DIRECTORY_NAMES.has(candidate.name))
    ) {
      continue;
    }

    byName.set(candidate.name, {
      kind: candidate.kind,
      name: candidate.name,
      path:
        relativeDir === ""
          ? candidate.name
          : `${relativeDir}/${candidate.name}`,
    });
  }

  // Drop any host absolute paths that somehow escaped naming — keep relative only.
  void parsed;

  return [...byName.values()].sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return sortNames.compare(left.name, right.name);
  });
}

/** @deprecated Prefer projectExplorerEntries with host absolute listing. */
export function immediateChildren(
  relativeDir: string,
  paths: readonly {
    kind: "directory" | "file";
    name: string;
    path: string;
  }[],
): ExplorerEntry[] {
  return projectExplorerEntries(relativeDir, "/", paths);
}

export default function plugin(bb: BbPluginApi) {
  const host = bb.hosts.experimental_client({
    contract: hostContract,
  });

  async function getExplorerContext(
    threadId: string,
  ): Promise<ExplorerContext> {
    const thread = await bb.sdk.threads.get({ threadId });
    if (thread.environmentId === null) {
      throw new Error("This thread does not have a workspace environment");
    }

    const environment = await bb.sdk.environments.get({
      environmentId: thread.environmentId,
    });
    if (environment.path === null) {
      throw new Error("The thread workspace is not available yet");
    }
    if (environment.projectId !== thread.projectId) {
      throw new Error("Thread and environment project do not match");
    }

    return {
      environmentId: environment.id,
      hostId: environment.hostId,
      rootName: rootName(environment.path),
      rootPath: environment.path,
    };
  }

  bb.rpc.register(rpcContract, {
    getExplorerContext: ({ threadId }) => getExplorerContext(threadId),
    async listChildren({ threadId, relativeDir }) {
      const safeRelativeDir = normalizeRelativeDirectory(relativeDir);
      const context = await getExplorerContext(threadId);
      const absoluteDir = joinWorkspacePath(
        context.rootPath,
        safeRelativeDir,
      );
      const listed = await host.call(
        "listDirectory",
        { path: absoluteDir, rootPath: context.rootPath },
        { hostId: context.hostId },
      );

      return {
        context,
        entries: projectExplorerEntries(
          safeRelativeDir,
          context.rootPath,
          listed.entries,
        ),
        truncated: listed.truncated,
      };
    },
    async searchFiles({ threadId, query, limit }) {
      const context = await getExplorerContext(threadId);
      const result = await host.call(
        "searchPaths",
        {
          rootPath: context.rootPath,
          query,
          limit: limit ?? 100,
        },
        { hostId: context.hostId },
      );

      return {
        context,
        hits: result.hits.map((hit) => ({
          kind: hit.kind,
          name: hit.name,
          path: hit.path,
        })),
        truncated: result.truncated,
      };
    },
    async readTextFile({ threadId, path: relativePath }) {
      const safePath = normalizeRelativeFilePath(relativePath);
      const context = await getExplorerContext(threadId);
      const absolutePath = joinWorkspacePath(context.rootPath, safePath);
      const file = await bb.sdk.files.read({
        hostId: context.hostId,
        path: absolutePath,
        rootPath: context.rootPath,
      });
      if (file.contentEncoding !== "utf8") {
        return { kind: "unsupported" as const, reason: "This file is not text" };
      }
      if (file.sizeBytes > MAX_EDITABLE_BYTES) {
        return {
          kind: "unsupported" as const,
          reason: `This file is too large to edit (${Math.round(file.sizeBytes / 1024 / 1024)} MB)`,
        };
      }
      return {
        kind: "text" as const,
        content: file.content,
        sha256: file.sha256,
        absolutePath: file.path,
      };
    },
    async writeTextFile({ threadId, path: relativePath, content, expectedSha256 }) {
      const safePath = normalizeRelativeFilePath(relativePath);
      const context = await getExplorerContext(threadId);
      const absolutePath = joinWorkspacePath(context.rootPath, safePath);
      const result = await bb.sdk.files.write({
        hostId: context.hostId,
        path: absolutePath,
        rootPath: context.rootPath,
        content,
        contentEncoding: "utf8",
        expectedSha256,
      });
      return result.outcome === "written"
        ? { outcome: "written" as const, sha256: result.sha256 }
        : {
            outcome: "conflict" as const,
            currentSha256: result.currentSha256,
          };
    },
  });
}
