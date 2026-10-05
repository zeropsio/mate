/**
 * What a write or an edit wrote, under its row once opened (D9): a new
 * file's content, an edit's change — each in one box of the opened detail's
 * height that scrolls inside, the box growing only under the row, so nothing
 * above it moves. Each file says where it is and opens in the Files tab:
 * inside the workspace as any file there, outside it read-only, served only
 * because this thread's agent wrote it (`threads.readWrittenFile`).
 */
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { FileWrite, ScopedThreadRef } from "@t3tools/contracts";
import { use, useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";

import { cn } from "~/lib/utils";
import { useRightPanelStore } from "../../rightPanelStore";
import { threadFileWritesCommands } from "../../state/threadFileWritesCommands";
import { useAtomCommand } from "../../state/use-atom-command";
import { diffLines, filesTarget } from "./fileWrites.logic";
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

/** A fade at each edge of a box that has more past it (`.run-capped`), as the person scrolls it. */
function useEdgeFades() {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = ref.current;
    if (box === null) return;
    const mark = () => {
      box.toggleAttribute("data-more-above", box.scrollTop > 1);
      box.toggleAttribute(
        "data-more-below",
        box.scrollTop + box.clientHeight < box.scrollHeight - 2,
      );
    };
    mark();
    box.addEventListener("scroll", mark, { passive: true });
    const resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(mark);
    resized?.observe(box);
    return () => {
      box.removeEventListener("scroll", mark);
      resized?.disconnect();
    };
  }, []);
  return ref;
}

const LINE_TONE = {
  kept: "text-foreground/70",
  added: "bg-success/8 text-foreground",
  removed: "bg-destructive/8 text-foreground/60",
  gap: "text-muted-foreground",
} as const;

const LINE_MARK = { kept: " ", added: "+", removed: "-", gap: "⋯" } as const;

function WrittenText({ write }: { readonly write: FileWrite }) {
  const boxRef = useEdgeFades();
  return (
    <div
      ref={boxRef}
      className="run-capped rounded-xl bg-foreground/4"
      data-capped="detail"
      data-file-write={write.kind}
    >
      <pre className={cn("min-w-0 px-3 py-2 font-mono select-text", META)}>
        {write.format === "content" ? (
          <span className="whitespace-pre-wrap break-words text-foreground/80">{write.text}</span>
        ) : (
          diffLines(write.text).map((line, index) => (
            <span
              // Lines are drawn once, in the order the change has them.
              // eslint-disable-next-line react/no-array-index-key
              key={index}
              className={cn("-mx-3 flex px-3", LINE_TONE[line.mark])}
              data-diff-line={line.mark}
            >
              <span aria-hidden="true" className="w-3 shrink-0 select-none text-muted-foreground">
                {LINE_MARK[line.mark]}
              </span>
              <span className="min-w-0 whitespace-pre-wrap break-words">{line.text}</span>
            </span>
          ))
        )}
      </pre>
    </div>
  );
}

/** What the calls of one row wrote, a file each, once the row is opened. */
export function FileWriteDetail({ callIds }: { readonly callIds: ReadonlyArray<string> }) {
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
            <WrittenText write={write} />
            {write.truncated ? (
              <p className={cn(META, "text-muted-foreground")}>
                Cut here: the file holds the rest.
              </p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
