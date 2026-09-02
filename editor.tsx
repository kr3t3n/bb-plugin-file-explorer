import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  FloppyDiskIcon,
  Loading03Icon,
  RefreshIcon,
} from "@hugeicons/core-free-icons";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { JsonValue } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "./server";

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function editorPathFromParams(params: JsonValue | null): string | null {
  if (
    params === null ||
    typeof params !== "object" ||
    Array.isArray(params) ||
    typeof params.path !== "string" ||
    params.path.trim() === ""
  ) {
    return null;
  }
  return params.path;
}

export function TextEditorPanel({
  threadId,
  params,
}: {
  threadId: string;
  params: JsonValue | null;
}) {
  const rpc = useRpc<typeof rpcContract>();
  const relativePath = editorPathFromParams(params);
  const [content, setContent] = useState("");
  const [baseline, setBaseline] = useState("");
  const [sha256, setSha256] = useState<string | null>(null);
  const [absolutePath, setAbsolutePath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const requestVersion = useRef(0);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const dirty = content !== baseline;

  const load = useCallback(async () => {
    if (relativePath === null) {
      setLoading(false);
      setError("No file path was provided.");
      return;
    }
    const version = ++requestVersion.current;
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const result = await rpc.call("readTextFile", {
        threadId,
        path: relativePath,
      });
      if (version !== requestVersion.current) return;
      if (result.kind === "unsupported") {
        setContent("");
        setBaseline("");
        setSha256(null);
        setAbsolutePath(null);
        setError(result.reason);
        return;
      }
      setContent(result.content);
      setBaseline(result.content);
      setSha256(result.sha256);
      setAbsolutePath(result.absolutePath);
    } catch (cause) {
      if (version !== requestVersion.current) return;
      setError(errorMessage(cause));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [relativePath, rpc, threadId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = useCallback(async () => {
    if (relativePath === null || sha256 === null || saving) return;
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const result = await rpc.call("writeTextFile", {
        threadId,
        path: relativePath,
        content,
        expectedSha256: sha256,
      });
      if (result.outcome === "conflict") {
        setError(
          "The file changed on disk. Reload it, then save your edits again.",
        );
        return;
      }
      setSha256(result.sha256);
      setBaseline(content);
      setStatus("Saved");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }, [content, relativePath, rpc, saving, sha256, threadId]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        void save();
      }
    },
    [save],
  );

  if (relativePath === null) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-muted-foreground">
        Open a file from the Files tree to edit it here.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold">{relativePath}</div>
          {absolutePath === null ? null : (
            <div
              className="truncate text-[10px] text-muted-foreground"
              title={absolutePath}
            >
              {absolutePath}
            </div>
          )}
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {dirty ? "Unsaved" : (status ?? "Saved")}
        </span>
        <button
          type="button"
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          onClick={() => void load()}
          disabled={loading || saving}
          aria-label="Reload file"
          title="Reload"
        >
          <HugeiconsIcon
            icon={RefreshIcon}
            className={`size-4 ${loading ? "animate-spin" : ""}`}
          />
        </button>
        <button
          type="button"
          className="inline-flex h-7 items-center gap-1 rounded-md border border-border px-2 text-xs hover:bg-state-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          onClick={() => void save()}
          disabled={loading || saving || !dirty || sha256 === null}
          aria-label="Save file"
          title="Save (Ctrl/Cmd+S)"
        >
          <HugeiconsIcon
            icon={saving ? Loading03Icon : FloppyDiskIcon}
            className={`size-3.5 ${saving ? "animate-spin" : ""}`}
          />
          Save
        </button>
      </div>

      {error === null ? null : (
        <div className="flex items-start gap-2 border-b border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <HugeiconsIcon
            icon={AlertCircleIcon}
            className="mt-0.5 size-3.5 shrink-0"
          />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div
          className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <HugeiconsIcon icon={Loading03Icon} className="size-4 animate-spin" />
          Loading file
        </div>
      ) : error !== null && sha256 === null ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          This file cannot be edited here.
        </div>
      ) : (
        <textarea
          ref={textareaRef}
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
            setStatus(null);
          }}
          onKeyDown={onKeyDown}
          spellCheck={false}
          className="min-h-0 flex-1 resize-none bg-background px-3 py-2 font-mono text-[13px] leading-relaxed text-foreground outline-none"
          aria-label={`Edit ${relativePath}`}
        />
      )}
    </div>
  );
}
