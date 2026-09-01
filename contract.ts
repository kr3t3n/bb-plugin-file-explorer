import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const hostEntrySchema = z.object({
  kind: z.enum(["directory", "file"]),
  name: z.string(),
  path: z.string(),
});

export const hostContract = defineRpcContract({
  listDirectory: {
    input: z
      .object({
        path: z.string().min(1),
        rootPath: z.string().min(1),
      })
      .strict(),
    output: z
      .object({
        entries: z.array(hostEntrySchema),
        truncated: z.boolean(),
      })
      .strict(),
  },
});
