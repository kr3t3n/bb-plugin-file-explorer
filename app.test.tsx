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
  it("registers a flush Files action and opens files in File Editor", async () => {
    const app = await loadPluginApp(() => import("./app"));
    const action = app.threadPanelActions.find(({ id }) => id === "files");

    expect(action).toMatchObject({
      id: "files",
      title: "Files",
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
        },
        openFilePreview: () => true,
      },
    );

    fireEvent.click(await slot.findByText("README.md"));
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "experimental_openFilePreview",
      options: {
        target: {
          kind: "workspace",
          environmentId: "environment-1",
          path: "README.md",
        },
        location: null,
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
