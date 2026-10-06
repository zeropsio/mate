/**
 * A file this conversation's agent wrote outside the workspace, in the Files
 * tab (D9, the owner: "Why can't this be opened in the Files tab?"): what the
 * thread's newest completed write of that exact path wrote there — a write's
 * content, an edit's new text — labelled with when it was written. It comes
 * from the thread's own record (`threads.writtenFile`); nothing is read from
 * disk, so nothing the file holds besides what the agent wrote is shown.
 */
import type {
  EnvironmentId,
  ScopedThreadRef,
  ThreadWrittenFileRefusal,
  ThreadWrittenFileResult,
} from "@t3tools/contracts";
import * as Cause from "effect/Cause";
import { useEffect, useState } from "react";

import { WrittenChanges } from "~/components/chat/FileWriteDetail";
import { writtenAtWords, writtenFileRefusalWords } from "~/components/chat/fileWrites.logic";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";
import { useClientSettings } from "~/hooks/useSettings";
import { threadFileWritesCommands } from "~/state/threadFileWritesCommands";
import { useAtomCommand } from "~/state/use-atom-command";
import { formatShortTimestamp } from "~/timestampFormat";
import { useKnownMate } from "~/zerops/useZeropsMates";

type Read =
  | { readonly state: "reading" }
  | { readonly state: "read"; readonly file: ThreadWrittenFileResult }
  | { readonly state: "refused"; readonly reason: ThreadWrittenFileRefusal | null };

function refusalOf(cause: Cause.Cause<unknown>): ThreadWrittenFileRefusal | null {
  const error = Cause.squash(cause) as { readonly _tag?: unknown; readonly reason?: unknown };
  return error?._tag === "ThreadFileWritesError"
    ? (error.reason as ThreadWrittenFileRefusal)
    : null;
}

/** Keyed by its path where it is drawn: another file is asked afresh. */
export default function WrittenFilePanel({
  environmentId,
  threadRef,
  path,
}: {
  readonly environmentId: EnvironmentId;
  readonly threadRef: ScopedThreadRef;
  readonly path: string;
}) {
  const mate = useKnownMate(environmentId)?.name ?? null;
  const timestampFormat = useClientSettings((settings) => settings.timestampFormat);
  const [read, setRead] = useState<Read>({ state: "reading" });
  const writtenFile = useAtomCommand(threadFileWritesCommands.writtenFile, {
    label: "written file",
    reportFailure: false,
  });
  useEffect(() => {
    let cancelled = false;
    void writtenFile({
      environmentId,
      input: { threadId: threadRef.threadId, path },
    }).then((result) => {
      if (cancelled) return;
      setRead(
        result._tag === "Success"
          ? { state: "read", file: result.value }
          : { state: "refused", reason: refusalOf(result.cause) },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [environmentId, path, writtenFile, threadRef.threadId]);

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
        {read.state === "read" ? (
          <span className="shrink-0 text-muted-foreground" data-written-at>
            {writtenAtWords(mate, formatShortTimestamp(read.file.writtenAt, timestampFormat))}
          </span>
        ) : null}
      </div>
      {read.state === "reading" ? (
        // Asked in a moment: nothing drawn that the answer then replaces.
        <div className="min-h-0 flex-1" />
      ) : read.state === "refused" ? (
        <div
          className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-xs leading-relaxed text-muted-foreground"
          data-written-file-refused={read.reason ?? "unavailable"}
        >
          {writtenFileRefusalWords(read.reason, mate)}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <div className="rounded-xl bg-foreground/4">
            <WrittenChanges write={read.file.write} />
          </div>
        </div>
      )}
    </div>
  );
}
