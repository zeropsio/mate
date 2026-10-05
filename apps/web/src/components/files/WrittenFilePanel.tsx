/**
 * A file this conversation's agent wrote outside the workspace, in the Files
 * tab, read-only (D9, the owner: "Why can't this be opened in the Files
 * tab?"). The server serves it only because this thread's own completed
 * write named this exact path (`threads.readWrittenFile`); anything else is
 * refused and said plainly here.
 */
import type { EnvironmentId, ScopedThreadRef, ThreadWrittenFileRefusal } from "@t3tools/contracts";
import { File, Virtualizer } from "@pierre/diffs/react";
import * as Cause from "effect/Cause";
import { useEffect, useState } from "react";

import { writtenFileRefusalWords } from "~/components/chat/fileWrites.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useClientSettings } from "~/hooks/useSettings";
import { useTheme } from "~/hooks/useTheme";
import { DIFF_SURFACE_THEME_UNSAFE_CSS, resolveDiffThemeName } from "~/lib/diffRendering";
import { threadFileWritesCommands } from "~/state/threadFileWritesCommands";
import { useAtomCommand } from "~/state/use-atom-command";

import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";
import { projectFileCacheKey } from "./fileContentRevision";

type Read =
  | { readonly state: "reading" }
  | { readonly state: "read"; readonly contents: string }
  | { readonly state: "refused"; readonly reason: ThreadWrittenFileRefusal | null };

function refusalOf(cause: Cause.Cause<unknown>): ThreadWrittenFileRefusal | null {
  const error = Cause.squash(cause) as { readonly _tag?: unknown; readonly reason?: unknown };
  return error?._tag === "ThreadFileWritesError"
    ? (error.reason as ThreadWrittenFileRefusal)
    : null;
}

/** Keyed by its path where it is drawn: another file is read afresh. */
export default function WrittenFilePanel({
  environmentId,
  threadRef,
  path,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly path: string;
}) {
  const { resolvedTheme } = useTheme();
  const wordWrap = useClientSettings((settings) => settings.wordWrap);
  const [read, setRead] = useState<Read>({ state: "reading" });
  const readWrittenFile = useAtomCommand(threadFileWritesCommands.readWrittenFile, {
    label: "read written file",
    reportFailure: false,
  });
  useEffect(() => {
    let cancelled = false;
    void readWrittenFile({
      environmentId,
      input: { threadId: threadRef.threadId, path },
    }).then((result) => {
      if (cancelled) return;
      setRead(
        result._tag === "Success"
          ? { state: "read", contents: result.value.contents }
          : { state: "refused", reason: refusalOf(result.cause) },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId, path, readWrittenFile, threadRef.threadId]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background">
      <div
        className="flex h-10 min-h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-background px-3 text-xs"
        data-surface-subheader
      >
        <Tooltip>
          <TooltipTrigger
            render={<span className="min-w-0 flex-1 truncate font-mono text-foreground" />}
          >
            {path}
          </TooltipTrigger>
          <TooltipPopup side="top">{path}</TooltipPopup>
        </Tooltip>
        <span className="shrink-0 text-muted-foreground">Read only</span>
      </div>
      {read.state === "reading" ? (
        // Read in a moment: nothing drawn that the file then replaces.
        <div className="min-h-0 flex-1" />
      ) : read.state === "refused" ? (
        <div
          className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs leading-relaxed text-muted-foreground"
          data-written-file-refused={read.reason ?? "unavailable"}
        >
          {writtenFileRefusalWords(read.reason)}
        </div>
      ) : (
        <DiffWorkerPoolProvider>
          <Virtualizer
            key={`${path}:${resolvedTheme}`}
            className="file-preview-virtualizer min-h-0 flex-1 overflow-auto"
            config={{ overscrollSize: 600, intersectionObserverMargin: 1200 }}
          >
            <File
              file={{
                name: path,
                contents: read.contents,
                cacheKey: projectFileCacheKey("written", path, read.contents),
              }}
              options={{
                disableFileHeader: true,
                overflow: wordWrap ? "wrap" : "scroll",
                theme: resolveDiffThemeName(resolvedTheme),
                themeType: resolvedTheme,
                unsafeCSS: DIFF_SURFACE_THEME_UNSAFE_CSS,
              }}
              className="min-h-full"
            />
          </Virtualizer>
        </DiffWorkerPoolProvider>
      )}
    </div>
  );
}
