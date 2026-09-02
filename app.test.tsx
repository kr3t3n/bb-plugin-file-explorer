// @vitest-environment jsdom
import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  loadPluginApp,
  renderSlot,
} from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";

describe("File Explorer panel", () => {
  it("registers Files + Editor actions and opens the editor tab", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const action = app.threadPanelActions.find(({ id }) => id === "files");
    const editor = app.threadPanelActions.find(({ id }) => id === "editor");

    expect(action).toMatchObject({
      id: "files",
      title: "Files",
      layout: "flush",
    });
    expect(editor).toMatchObject({
      id: "editor",
      title: "Editor",
      layout: "flush",
    });
    expect(action).toBeDefined();
    if (action === undefined) return;

    const context = {
      environmentId: "environment-1",
      hostId: "host-1",
      rootName: "project",
      rootPath: "/workspace/project",
    };
    const slot = renderSlot<PluginThreadPanelProps, typeof rpcContract>(
      action,
      { threadId: "thread-1", params: null },
      {
        rpc: {
          getExplorerContext: () => context,
          listChildren: ({ relativeDir }) => ({
            context,
            entries:
              relativeDir === ""
                ? [
                    {
                      kind: "directory" as const,
                      name: "src",
                      path: "src",
                    },
                    {
                      kind: "file" as const,
                      name: "README.md",
                      path: "README.md",
                    },
                  ]
                : [
                    {
                      kind: "file" as const,
                      name: "index.ts",
                      path: "src/index.ts",
                    },
                  ],
            truncated: false,
          }),
          searchFiles: () => ({
            context,
            hits: [
              {
                kind: "file" as const,
                name: ".env",
                path: ".env",
              },
            ],
            truncated: false,
          }),
          readTextFile: () => ({
            kind: "text" as const,
            content: "",
            sha256: "abc",
            absolutePath: "/workspace/project/README.md",
          }),
          writeTextFile: () => ({
            outcome: "written" as const,
            sha256: "def",
          }),
        },
        openThreadPanel: () => true,
      },
    );

    fireEvent.click(await slot.findByText("README.md"));
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "openThreadPanel",
      options: {
        actionId: "editor",
        title: "README.md",
        params: { path: "README.md" },
      },
    });

    fireEvent.click(slot.getByText("src"));
    expect(await slot.findByText("index.ts")).toBeTruthy();

    const search = slot.getByLabelText("Search workspace files");
    fireEvent.change(search, { target: { value: ".env" } });
    await waitFor(
      () => {
        expect(slot.getByText(".env")).toBeTruthy();
      },
      { timeout: 1000 },
    );

    slot.lifecycle.unmount();
  });
});
