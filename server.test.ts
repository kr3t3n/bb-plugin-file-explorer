import { describe, expect, it } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin, {
  immediateChildren,
  joinWorkspacePath,
  normalizeRelativeDirectory,
  normalizeRelativeFilePath,
  projectExplorerEntries,
} from "./server";

describe("path confinement", () => {
  it("accepts canonical relative directories including hidden ones", () => {
    expect(normalizeRelativeDirectory("src/components")).toBe("src/components");
    expect(normalizeRelativeDirectory(".git/objects")).toBe(".git/objects");
    expect(normalizeRelativeDirectory(".claude")).toBe(".claude");
    expect(normalizeRelativeDirectory("")).toBe("");
  });

  it("accepts relative file paths including hidden files", () => {
    expect(normalizeRelativeFilePath(".env")).toBe(".env");
    expect(normalizeRelativeFilePath("src/.env.local")).toBe("src/.env.local");
  });

  it("rejects empty file paths", () => {
    expect(() => normalizeRelativeFilePath("")).toThrow();
  });

  it.each([
    "/etc",
    "../outside",
    "src/../outside",
    "src//components",
    "C:/Users/test",
    String.raw`src\components`,
    "node_modules/package",
    "dist/assets",
  ])("rejects %s", (candidate) => {
    expect(() => normalizeRelativeDirectory(candidate)).toThrow();
  });

  it("joins paths for Linux and Windows hosts", () => {
    expect(joinWorkspacePath("/home/bb/project", "src/components")).toBe(
      "/home/bb/project/src/components",
    );
    expect(joinWorkspacePath(String.raw`C:\work\project`, "src/components")).toBe(
      String.raw`C:\work\project\src\components`,
    );
  });
});

describe("directory projection", () => {
  it("keeps hidden files, hides generated noise, and sorts folders first", () => {
    expect(
      projectExplorerEntries("", "/workspace", [
        { kind: "file", name: "z.txt", path: "/workspace/z.txt" },
        { kind: "directory", name: "src", path: "/workspace/src" },
        { kind: "file", name: ".env", path: "/workspace/.env" },
        { kind: "directory", name: ".git", path: "/workspace/.git" },
        { kind: "directory", name: "node_modules", path: "/workspace/node_modules" },
        { kind: "file", name: "a.txt", path: "/workspace/a.txt" },
      ]),
    ).toEqual([
      { kind: "directory", name: ".git", path: ".git" },
      { kind: "directory", name: "src", path: "src" },
      { kind: "file", name: ".env", path: ".env" },
      { kind: "file", name: "a.txt", path: "a.txt" },
      { kind: "file", name: "z.txt", path: "z.txt" },
    ]);
  });

  it("keeps compatibility immediateChildren helper", () => {
    expect(
      immediateChildren("", [
        { kind: "file", name: "z.txt", path: "z.txt" },
        { kind: "directory", name: "src", path: "src" },
        { kind: "directory", name: "node_modules", path: "node_modules" },
      ]),
    ).toEqual([
      { kind: "directory", name: "src", path: "src" },
      { kind: "file", name: "z.txt", path: "z.txt" },
    ]);
  });
});

describe("explorer RPC", () => {
  it("lists through the host entry with workspace confinement", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "file-explorer",
      experimental_callHostRpc: async (call) => {
        expect(call.method).toBe("listDirectory");
        expect(call.hostId).toBe("host-1");
        expect(call.input).toEqual({
          path: "/workspace/project/src",
          rootPath: "/workspace/project",
        });
        return {
          entries: [
            {
              kind: "file",
              name: "index.ts",
              path: "/workspace/project/src/index.ts",
            },
            {
              kind: "file",
              name: ".env.local",
              path: "/workspace/project/src/.env.local",
            },
          ],
          truncated: false,
        };
      },
    });
    harness.sdk.stub(
      "threads.get",
      async () =>
        ({
          id: "thread-1",
          environmentId: "environment-1",
          projectId: "project-1",
        }) as never,
    );
    harness.sdk.stub(
      "environments.get",
      async () =>
        ({
          id: "environment-1",
          hostId: "host-1",
          path: "/workspace/project",
          projectId: "project-1",
        }) as never,
    );

    await plugin(bb);
    const result = (await harness.behavior.callRpc("listChildren", {
      threadId: "thread-1",
      relativeDir: "src",
    })) as {
      context: { environmentId: string; hostId: string; rootPath: string };
      entries: { kind: string; name: string; path: string }[];
    };

    expect(result.context).toMatchObject({
      environmentId: "environment-1",
      hostId: "host-1",
      rootPath: "/workspace/project",
    });
    expect(result.entries).toEqual([
      { kind: "file", name: ".env.local", path: "src/.env.local" },
      { kind: "file", name: "index.ts", path: "src/index.ts" },
    ]);
  });

  it("searches through the host entry including hidden files", async () => {
    const { bb, harness } = createFakePluginHost({
      pluginId: "file-explorer",
      experimental_callHostRpc: async (call) => {
        expect(call.method).toBe("searchPaths");
        expect(call.hostId).toBe("host-1");
        expect(call.input).toEqual({
          rootPath: "/workspace/project",
          query: ".env",
          limit: 100,
        });
        return {
          hits: [
            {
              kind: "file",
              name: ".env",
              path: ".env",
            },
            {
              kind: "file",
              name: ".env.local",
              path: "src/.env.local",
            },
          ],
          truncated: false,
        };
      },
    });
    harness.sdk.stub(
      "threads.get",
      async () =>
        ({
          id: "thread-1",
          environmentId: "environment-1",
          projectId: "project-1",
        }) as never,
    );
    harness.sdk.stub(
      "environments.get",
      async () =>
        ({
          id: "environment-1",
          hostId: "host-1",
          path: "/workspace/project",
          projectId: "project-1",
        }) as never,
    );

    await plugin(bb);
    const result = (await harness.behavior.callRpc("searchFiles", {
      threadId: "thread-1",
      query: ".env",
    })) as {
      hits: { kind: string; name: string; path: string }[];
      truncated: boolean;
    };

    expect(result.truncated).toBe(false);
    expect(result.hits).toEqual([
      { kind: "file", name: ".env", path: ".env" },
      { kind: "file", name: ".env.local", path: "src/.env.local" },
    ]);
  });
});
