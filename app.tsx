import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  AlertCircleIcon,
  ArrowDown01Icon,
  ArrowRight01Icon,
  File01Icon,
  FolderIcon,
  FolderOpenIcon,
  Loading03Icon,
  RefreshIcon,
  Search01Icon,
} from "@hugeicons/core-free-icons";
import {
  definePluginApp,
  useBbNavigate,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import { FILE_EDITOR_VIEWER } from "./constants";
import type {
  ExplorerContext,
  ExplorerEntry,
  rpcContract,
} from "./server";

interface VisibleRow {
  depth: number;
  entry: ExplorerEntry;
}

function flattenVisibleRows(
  children: Readonly<Record<string, readonly ExplorerEntry[]>>,
  expanded: ReadonlySet<string>,
): VisibleRow[] {
  const rows: VisibleRow[] = [];

  const append = (parentPath: string, depth: number) => {
    for (const entry of children[parentPath] ?? []) {
      rows.push({ depth, entry });
      if (entry.kind === "directory" && expanded.has(entry.path)) {
        append(entry.path, depth + 1);
      }
    }
  };

  append("", 0);
  return rows;
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function ExplorerPanel({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const navigate = useBbNavigate();
  const [context, setContext] = useState<ExplorerContext | null>(null);
  const [children, setChildren] = useState<Record<string, ExplorerEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState<Set<string>>(() => new Set([""]));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [truncated, setTruncated] = useState<Set<string>>(() => new Set());
  const [activeIndex, setActiveIndex] = useState(0);
  const [openError, setOpenError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [searchHits, setSearchHits] = useState<ExplorerEntry[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const requestVersion = useRef(0);
  const searchVersion = useRef(0);
  const rowRefs = useRef(new Map<string, HTMLButtonElement>());
  const searchInputRef = useRef<HTMLInputElement>(null);

  const isSearching = debouncedQuery.length > 0;

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedQuery(searchQuery.trim());
    }, 200);
    return () => window.clearTimeout(handle);
  }, [searchQuery]);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    setContext(null);
    setChildren({});
    setExpanded(new Set());
    setLoading(new Set([""]));
    setErrors({});
    setTruncated(new Set());
    setOpenError(null);
    setActiveIndex(0);
    setSearchHits([]);
    setSearchError(null);
    setSearchTruncated(false);

    try {
      const [nextContext, root] = await Promise.all([
        rpc.call("getExplorerContext", { threadId }),
        rpc.call("listChildren", { threadId, relativeDir: "" }),
      ]);
      if (version !== requestVersion.current) return;
      if (nextContext.environmentId !== root.context.environmentId) {
        throw new Error("The thread workspace changed while loading");
      }
      setContext(nextContext);
      setChildren({ "": root.entries });
      setTruncated(root.truncated ? new Set([""]) : new Set());
    } catch (cause) {
      if (version !== requestVersion.current) return;
      setErrors({ "": errorMessage(cause) });
    } finally {
      if (version === requestVersion.current) setLoading(new Set());
    }
  }, [rpc, threadId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (debouncedQuery.length === 0) {
      setSearchHits([]);
      setSearchError(null);
      setSearchTruncated(false);
      setSearchLoading(false);
      return;
    }

    const version = ++searchVersion.current;
    setSearchLoading(true);
    setSearchError(null);

    void (async () => {
      try {
        const result = await rpc.call("searchFiles", {
          threadId,
          query: debouncedQuery,
          limit: 100,
        });
        if (version !== searchVersion.current) return;
        setContext(result.context);
        setSearchHits(result.hits);
        setSearchTruncated(result.truncated);
      } catch (cause) {
        if (version !== searchVersion.current) return;
        setSearchHits([]);
        setSearchError(errorMessage(cause));
      } finally {
        if (version === searchVersion.current) setSearchLoading(false);
      }
    })();
  }, [debouncedQuery, rpc, threadId]);

  const loadDirectory = useCallback(
    async (relativeDir: string) => {
      const version = requestVersion.current;
      setLoading((current) => new Set(current).add(relativeDir));
      setErrors((current) => {
        const next = { ...current };
        delete next[relativeDir];
        return next;
      });

      try {
        const result = await rpc.call("listChildren", {
          threadId,
          relativeDir,
        });
        if (version !== requestVersion.current) return;
        if (
          context !== null &&
          result.context.environmentId !== context.environmentId
        ) {
          throw new Error("The thread workspace changed. Refresh the explorer.");
        }
        setContext(result.context);
        setChildren((current) => ({
          ...current,
          [relativeDir]: result.entries,
        }));
        setExpanded((current) => new Set(current).add(relativeDir));
        setTruncated((current) => {
          const next = new Set(current);
          if (result.truncated) next.add(relativeDir);
          else next.delete(relativeDir);
          return next;
        });
      } catch (cause) {
        if (version !== requestVersion.current) return;
        setErrors((current) => ({
          ...current,
          [relativeDir]: errorMessage(cause),
        }));
      } finally {
        if (version === requestVersion.current) {
          setLoading((current) => {
            const next = new Set(current);
            next.delete(relativeDir);
            return next;
          });
        }
      }
    },
    [context, rpc, threadId],
  );

  const toggleDirectory = useCallback(
    (relativeDir: string) => {
      if (expanded.has(relativeDir)) {
        setExpanded((current) => {
          const next = new Set(current);
          next.delete(relativeDir);
          return next;
        });
        return;
      }
      if (children[relativeDir] !== undefined) {
        setExpanded((current) => new Set(current).add(relativeDir));
        return;
      }
      void loadDirectory(relativeDir);
    },
    [children, expanded, loadDirectory],
  );

  const rows = useMemo(
    () => flattenVisibleRows(children, expanded),
    [children, expanded],
  );

  const visibleEntries = useMemo(
    () => (isSearching ? searchHits : rows.map((row) => row.entry)),
    [isSearching, rows, searchHits],
  );

  useEffect(() => {
    if (visibleEntries.length === 0) {
      setActiveIndex(0);
    } else if (activeIndex >= visibleEntries.length) {
      setActiveIndex(visibleEntries.length - 1);
    }
  }, [activeIndex, visibleEntries.length]);

  const focusRow = useCallback(
    (index: number) => {
      if (visibleEntries.length === 0) return;
      const nextIndex = Math.max(0, Math.min(index, visibleEntries.length - 1));
      setActiveIndex(nextIndex);
      const path = visibleEntries[nextIndex]?.path;
      if (path !== undefined) {
        queueMicrotask(() => rowRefs.current.get(path)?.focus());
      }
    },
    [visibleEntries],
  );

  const openFile = useCallback(
    (entry: ExplorerEntry) => {
      if (context === null) return;
      setOpenError(null);
      const options = {
        target: {
          kind: "workspace" as const,
          environmentId: context.environmentId,
          path: entry.path,
        },
        location: null,
        // Prefer BB File Editor (monaco). Host falls back to preview if unavailable.
        viewer: FILE_EDITOR_VIEWER,
      };
      const accepted = navigate.experimental_openFilePreview(options);
      if (!accepted) {
        setOpenError("BB could not open the file editor from this panel.");
      }
    },
    [context, navigate],
  );

  const activateEntry = useCallback(
    (entry: ExplorerEntry) => {
      if (entry.kind === "directory") {
        if (isSearching) {
          setSearchQuery("");
          setDebouncedQuery("");
          toggleDirectory(entry.path);
          return;
        }
        toggleDirectory(entry.path);
      } else {
        openFile(entry);
      }
    },
    [isSearching, openFile, toggleDirectory],
  );

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
      const entry = visibleEntries[index];
      if (entry === undefined) return;

      switch (event.key) {
        case "ArrowUp":
          event.preventDefault();
          focusRow(index - 1);
          break;
        case "ArrowDown":
          event.preventDefault();
          focusRow(index + 1);
          break;
        case "Home":
          event.preventDefault();
          focusRow(0);
          break;
        case "End":
          event.preventDefault();
          focusRow(visibleEntries.length - 1);
          break;
        case "Enter":
          event.preventDefault();
          activateEntry(entry);
          break;
        case "ArrowRight": {
          if (isSearching || entry.kind !== "directory") break;
          event.preventDefault();
          if (!expanded.has(entry.path)) {
            toggleDirectory(entry.path);
          } else if (rows[index + 1]?.depth === (rows[index]?.depth ?? 0) + 1) {
            focusRow(index + 1);
          }
          break;
        }
        case "ArrowLeft": {
          if (isSearching) break;
          if (entry.kind === "directory" && expanded.has(entry.path)) {
            event.preventDefault();
            toggleDirectory(entry.path);
            break;
          }
          const parentPath = entry.path.split("/").slice(0, -1).join("/");
          if (parentPath !== "") {
            const parentIndex = rows.findIndex(
              (candidate) => candidate.entry.path === parentPath,
            );
            if (parentIndex >= 0) {
              event.preventDefault();
              focusRow(parentIndex);
            }
          }
          break;
        }
      }
    },
    [
      activateEntry,
      expanded,
      focusRow,
      isSearching,
      rows,
      toggleDirectory,
      visibleEntries,
    ],
  );

  const directoryError = Object.entries(errors).find(([key]) => key !== "");
  const footerMessage =
    openError ??
    searchError ??
    directoryError?.[1] ??
    (searchTruncated
      ? "Search results were truncated. Narrow the query."
      : truncated.size > 0
        ? "Some paths were omitted because this directory is very large."
        : null);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-2">
        <HugeiconsIcon icon={FolderIcon} className="size-4 shrink-0" />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-semibold uppercase tracking-wide">
            {context?.rootName ?? "Workspace"}
          </div>
          {context === null ? null : (
            <div
              className="truncate text-[10px] text-muted-foreground"
              title={context.rootPath}
            >
              {context.rootPath}
            </div>
          )}
        </div>
        <button
          type="button"
          className="inline-flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-state-hover hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
          onClick={() => void refresh()}
          disabled={loading.has("")}
          aria-label="Refresh file explorer"
          title="Refresh"
        >
          <HugeiconsIcon
            icon={RefreshIcon}
            className={`size-4 ${loading.has("") ? "animate-spin" : ""}`}
          />
        </button>
      </div>

      <div className="shrink-0 border-b border-border px-2 py-1.5">
        <label className="flex h-7 items-center gap-1.5 rounded-md border border-border bg-background px-2">
          <HugeiconsIcon
            icon={Search01Icon}
            className="size-3.5 shrink-0 text-muted-foreground"
          />
          <input
            ref={searchInputRef}
            type="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search files (includes .hidden)"
            className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted-foreground"
            aria-label="Search workspace files"
          />
          {searchLoading ? (
            <HugeiconsIcon
              icon={Loading03Icon}
              className="size-3.5 shrink-0 animate-spin text-muted-foreground"
            />
          ) : null}
        </label>
      </div>

      {errors[""] !== undefined ? (
        <div className="m-3 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
          <div className="flex items-start gap-2 text-destructive">
            <HugeiconsIcon
              icon={AlertCircleIcon}
              className="mt-0.5 size-4 shrink-0"
            />
            <span>{errors[""]}</span>
          </div>
          <button
            type="button"
            className="mt-3 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-state-hover"
            onClick={() => void refresh()}
          >
            Try again
          </button>
        </div>
      ) : loading.has("") && !isSearching ? (
        <div
          className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <HugeiconsIcon icon={Loading03Icon} className="size-4 animate-spin" />
          Loading workspace
        </div>
      ) : isSearching && searchLoading && searchHits.length === 0 ? (
        <div
          className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground"
          role="status"
        >
          <HugeiconsIcon icon={Loading03Icon} className="size-4 animate-spin" />
          Searching
        </div>
      ) : visibleEntries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground">
          {isSearching
            ? "No matching files."
            : "This workspace has no visible files."}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          <div
            role="tree"
            aria-label={isSearching ? "Search results" : "Workspace files"}
            aria-busy={loading.size > 0 || searchLoading}
          >
            {isSearching
              ? searchHits.map((entry, index) => {
                  const isDirectory = entry.kind === "directory";
                  return (
                    <button
                      key={entry.path}
                      ref={(element) => {
                        if (element === null) rowRefs.current.delete(entry.path);
                        else rowRefs.current.set(entry.path, element);
                      }}
                      type="button"
                      role="treeitem"
                      aria-level={1}
                      tabIndex={index === activeIndex ? 0 : -1}
                      className="flex h-6 w-full items-center gap-1 truncate px-2 text-left text-[13px] hover:bg-state-hover focus:bg-state-active focus:outline-none"
                      title={entry.path}
                      onFocus={() => setActiveIndex(index)}
                      onClick={() => activateEntry(entry)}
                      onKeyDown={(event) => handleKeyDown(event, index)}
                    >
                      <HugeiconsIcon
                        icon={isDirectory ? FolderIcon : File01Icon}
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {entry.path}
                      </span>
                    </button>
                  );
                })
              : rows.map((row, index) => {
                  const isDirectory = row.entry.kind === "directory";
                  const isExpanded =
                    isDirectory && expanded.has(row.entry.path);
                  const isLoading = loading.has(row.entry.path);
                  return (
                    <button
                      key={row.entry.path}
                      ref={(element) => {
                        if (element === null) {
                          rowRefs.current.delete(row.entry.path);
                        } else {
                          rowRefs.current.set(row.entry.path, element);
                        }
                      }}
                      type="button"
                      role="treeitem"
                      aria-level={row.depth + 1}
                      aria-expanded={isDirectory ? isExpanded : undefined}
                      tabIndex={index === activeIndex ? 0 : -1}
                      className="flex h-6 w-full items-center gap-1 truncate pr-2 text-left text-[13px] hover:bg-state-hover focus:bg-state-active focus:outline-none"
                      style={{ paddingLeft: 6 + row.depth * 14 }}
                      title={row.entry.path}
                      onFocus={() => setActiveIndex(index)}
                      onClick={() => activateEntry(row.entry)}
                      onKeyDown={(event) => handleKeyDown(event, index)}
                    >
                      {isDirectory ? (
                        <HugeiconsIcon
                          icon={
                            isExpanded ? ArrowDown01Icon : ArrowRight01Icon
                          }
                          className="size-3 shrink-0 text-muted-foreground"
                        />
                      ) : (
                        <span className="size-3 shrink-0" aria-hidden="true" />
                      )}
                      <HugeiconsIcon
                        icon={
                          isDirectory
                            ? isExpanded
                              ? FolderOpenIcon
                              : FolderIcon
                            : File01Icon
                        }
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {row.entry.name}
                      </span>
                      {isLoading ? (
                        <HugeiconsIcon
                          icon={Loading03Icon}
                          className="size-3 shrink-0 animate-spin text-muted-foreground"
                        />
                      ) : null}
                    </button>
                  );
                })}
          </div>
        </div>
      )}

      {footerMessage === null ? null : (
        <div
          className="shrink-0 border-t border-border px-2 py-1.5 text-xs text-muted-foreground"
          role="status"
        >
          {footerMessage}
        </div>
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: "files",
    title: "Files",
    icon: "Folder",
    component: ExplorerPanel,
    layout: "flush",
  });

  app.slots.commandPaletteAction({
    id: "open-file-explorer",
    title: "File Explorer: Open explorer",
    isAvailable: ({ threadId }) => threadId !== null,
    run: ({ openPanel }) => {
      openPanel({ actionId: "files", title: "Files" });
    },
  });
});
