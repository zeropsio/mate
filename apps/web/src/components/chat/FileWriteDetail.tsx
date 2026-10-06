/**
 * What a write or an edit wrote, under its row once opened (D9): a write's
 * content, an edit's new text — only what the agent itself wrote in the call,
 * from the thread's record, never read from disk. Each file's text stands in
 * the card's own item box, as every item's: whole in the log, nothing
 * scrolling inside; it grows only under the row, so nothing above it moves.
 * Each file says where it is and opens in the Files tab: inside the workspace
 * as any file there, outside it as the thread's newest write of it left it
 * (`threads.writtenFile`).
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { FileWrite, ScopedThreadRef } from "@t3tools/contracts";
import { Fragment, type ReactNode, use, useEffect, useEffectEvent, useState } from "react";

import { cn } from "~/lib/utils";
import { useRightPanelStore } from "../../rightPanelStore";
import { threadFileWritesCommands } from "../../state/threadFileWritesCommands";
import { useAtomCommand } from "../../state/use-atom-command";
import { filesTarget, removedWords } from "./fileWrites.logic";
import { TimelineRowCtx } from "./timelineContext";

const META = "text-line";

/** What each call wrote, by thread and call: a row opened again draws at once. */
const written = new Map<string, ReadonlyArray<FileWrite>>();
const WRITTEN_KEPT = 200;

function keyOf(threadRef: ScopedThreadRef, callId: string): string {
  return `${scopedThreadKey(threadRef)}|${callId}`;
}

function remembered(
  threadRef: ScopedThreadRef | null,
  callIds: ReadonlyArray<string>,
): ReadonlyArray<FileWrite> | null {
  if (threadRef === null) return null;
  const known = callIds.map((callId) => written.get(keyOf(threadRef, callId)));
  return known.every((writes) => writes !== undefined) ? known.flat() : null;
}

function remember(threadRef: ScopedThreadRef, callId: string, writes: ReadonlyArray<FileWrite>) {
  written.delete(keyOf(threadRef, callId));
  written.set(keyOf(threadRef, callId), writes);
  if (written.size > WRITTEN_KEPT) written.delete(written.keys().next().value!);
}

type Asked =
  | { readonly state: "reading" }
  | { readonly state: "read"; readonly writes: ReadonlyArray<FileWrite> }
  | { readonly state: "failed" };

/** The writes of these calls, from memory or asked once. */
function useFileWrites(threadRef: ScopedThreadRef | null, callIds: ReadonlyArray<string>): Asked {
  const [asked, setAsked] = useState<Asked>(() => {
    const known = remembered(threadRef, callIds);
    return known === null ? { state: "reading" } : { state: "read", writes: known };
  });
  const ask = useAtomCommand(threadFileWritesCommands.fileWrites, {
    label: "thread file writes",
    reportFailure: false,
  });
  // The calls by their ids, the thread by its key: the same ones asked again ask nothing.
  const callKey = callIds.join("|");
  const threadKey = threadRef === null ? null : scopedThreadKey(threadRef);
  const read = useEffectEvent((done: () => boolean) => {
    if (threadRef === null) return;
    const known = remembered(threadRef, callIds);
    if (known !== null) {
      setAsked({ state: "read", writes: known });
      return;
    }
    void ask({
      environmentId: threadRef.environmentId,
      input: { threadId: threadRef.threadId, toolCallIds: [...callIds] },
    }).then((result) => {
      if (done()) return;
      if (result._tag !== "Success") {
        setAsked({ state: "failed" });
        return;
      }
      const byCall = new Map(result.value.calls.map((call) => [call.toolCallId, call.writes]));
      for (const callId of callIds) remember(threadRef, callId, byCall.get(callId) ?? []);
      setAsked({ state: "read", writes: callIds.flatMap((callId) => byCall.get(callId) ?? []) });
    });
  });
  useEffect(() => {
    let cancelled = false;
    read(() => cancelled);
    return () => {
      cancelled = true;
    };
  }, [threadKey, callKey]);
  return asked;
}

/**
 * What one call wrote in one file, as the agent wrote it: a write's content,
 * an edit's new text change by change — a change that only removed lines is
 * their count. Never the old text, nor the lines around a change.
 */
export function WrittenChanges({ write }: { readonly write: FileWrite }) {
  return (
    <div data-file-write={write.kind}>
      <pre className={cn("min-w-0 px-3 py-2 font-mono select-text", META)}>
        {write.changes.map((change, index) => (
          // Changes are drawn once, in the order the call made them.
          // eslint-disable-next-line react/no-array-index-key
          <Fragment key={index}>
            {index > 0 ? (
              <span aria-hidden="true" className="block select-none text-muted-foreground">
                ⋯
              </span>
            ) : null}
            {change.text.length > 0 ? (
              <span
                className={cn(
                  "block whitespace-pre-wrap break-words text-foreground/80",
                  write.kind === "edit" && "-mx-3 bg-success/8 px-3",
                )}
                data-change="wrote"
              >
                {change.text}
              </span>
            ) : (
              <span className="block font-sans text-muted-foreground" data-change="removed">
                {removedWords(change.removedLines)}
              </span>
            )}
          </Fragment>
        ))}
      </pre>
    </div>
  );
}

/** What the calls of one row wrote, a file each, once the row is opened. */
export function FileWriteDetail({
  callIds,
  box,
}: {
  readonly callIds: ReadonlyArray<string>;
  /**
   * The card's item box (`CappedBox`), as every item's text stands in: in the
   * log all of it, nothing scrolling inside; in the working row its height,
   * scrolling. `part` tells each file's box apart.
   */
  readonly box: (part: string, children: ReactNode) => ReactNode;
}) {
  const { threadRef, workspaceRoot, markdownCwd } = use(TimelineRowCtx);
  const asked = useFileWrites(threadRef, callIds);
  if (asked.state === "reading") return null;
  if (asked.state === "failed") {
    return <p className={cn(META, "text-muted-foreground")}>What it wrote could not be read.</p>;
  }
  const cwd = workspaceRoot ?? markdownCwd ?? null;
  return (
    <div className="grid min-w-0 gap-2" data-file-writes>
      {asked.writes.map((write, index) => {
        const target = filesTarget(write.path, cwd);
        const shown = target?.kind === "workspace" ? target.path : write.path;
        return (
          // A call may write one file twice (a patch's two parts): by place, too.
          // eslint-disable-next-line react/no-array-index-key
          <section key={`${write.path}:${index}`} aria-label={shown} className="grid min-w-0 gap-1">
            <div className={cn("flex min-w-0 items-baseline gap-3", META)}>
              <span className="min-w-0 flex-1 truncate font-mono text-muted-foreground">
                {shown}
              </span>
              {target !== null && threadRef !== null ? (
                <button
                  className="shrink-0 cursor-pointer rounded-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70"
                  data-open-in-files={target.kind}
                  onClick={() => useRightPanelStore.getState().openFile(threadRef, target.path)}
                  type="button"
                >
                  Open in Files
                </button>
              ) : null}
            </div>
            {box(`write:${index}`, <WrittenChanges write={write} />)}
            {write.truncated ? (
              <p className={cn(META, "text-muted-foreground")}>Cut here: it wrote more.</p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
