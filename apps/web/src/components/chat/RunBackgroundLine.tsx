import { ChevronDownIcon } from "lucide-react";
import { useState } from "react";
import { cn } from "~/lib/utils";
import { Collapsible, CollapsibleTrigger } from "../ui/collapsible";
import { OutputBlock } from "./RunDisclosure";
import {
  backgroundItemWord,
  reportsInline,
  type BackgroundLineModel,
} from "./backgroundLine.logic";
import { useHoldReading } from "./runCardContext";
import { Text } from "~/components/ui/text";

// ---------------------------------------------------------------------------
// Background work, outside any card
// ---------------------------------------------------------------------------

/**
 * Background work as one quiet line (`backgroundLine.logic`): what a turn
 * sent to the background, on its own card, or what woke the run under it —
 * what runs, what finished, what failed — and, opened, each task once, a
 * failure first, with what it reported; never the line's own words again.
 * Red is a failure that still stands (`line.failed`): a run that ended well
 * says what failed of its jobs in the same words, as quiet as the rest (K9).
 */
export function BackgroundLine({ line }: { readonly line: BackgroundLineModel }) {
  const hold = useHoldReading();
  const [open, setOpen] = useState(false);
  const { words, where, failed, items, single: lone } = line;
  const opens = items.length > 0;
  const head = (
    <span className="flex min-w-0 items-center text-line">
      {/* The page's mark column: its dot where an event's icon stands, its
          words on the edge the answer's list items start on. */}
      <span aria-hidden="true" className="flex w-5 shrink-0">
        <span className="flex size-3.5 items-center justify-center">
          <span
            className={cn(
              "size-1.5 rounded-full",
              failed ? "bg-status-failed" : "bg-muted-foreground/35",
            )}
          />
        </span>
      </span>
      <span
        className={cn(
          "min-w-0 truncate",
          // Several: the dot says one failed, the words say which in their own.
          failed && lone ? "text-status-failed-text" : "text-foreground/85",
        )}
      >
        {words}
      </span>
      {where === null ? null : (
        <Text className="ms-2.5 shrink-0" variant="remark">
          {where}
        </Text>
      )}
      {opens ? (
        <ChevronDownIcon
          aria-hidden="true"
          className="ms-2.5 size-3 shrink-0 text-muted-foreground/70 opacity-0 transition-[opacity,rotate] duration-150 group-hover/disclose:opacity-100 group-aria-expanded/disclose:rotate-180 group-aria-expanded/disclose:opacity-100"
        />
      ) : null}
    </span>
  );
  const said = where === null ? words : `${words}, ${where}`;
  return (
    <div className="grid min-w-0 gap-2" data-background-line>
      {opens ? (
        <Collapsible
          className="contents"
          open={open}
          onOpenChange={(next) => {
            hold(next);
            setOpen(next);
          }}
        >
          <CollapsibleTrigger
            aria-label={`${said}. ${open ? "Hide" : "Show"} ${lone ? "what it reported" : "each one"}`}
            className="group/disclose -mx-1.5 flex min-h-7 w-[calc(100%+0.75rem)] items-center rounded-control px-1.5 text-start transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70 focus-visible:ring-inset"
          >
            {head}
          </CollapsibleTrigger>
        </Collapsible>
      ) : (
        <div className="flex min-h-7 items-center">{head}</div>
      )}
      {open ? (
        <ul
          className="grid min-w-0 animate-detail-in gap-3 ps-5 motion-reduce:animate-none"
          data-chat-detail
        >
          {items.map((item) => (
            <li key={item.key} className="grid min-w-0 gap-1">
              {/* One task's line says its title and state: only its report opens. */}
              {lone ? null : (
                <span className="text-line text-foreground/85">
                  {item.title}
                  <span
                    className={
                      failed && item.state === "failed"
                        ? "text-status-failed-text"
                        : "text-muted-foreground"
                    }
                  >
                    {` · ${backgroundItemWord(item)}`}
                    {/* A one-line report reads on the row: "· failed · Exit code 3". */}
                    {item.report !== null && !lone && reportsInline(item.report)
                      ? ` · ${item.report}`
                      : null}
                  </span>
                </span>
              )}
              {item.report === null || (!lone && reportsInline(item.report)) ? null : (
                <OutputBlock mono={item.mono} text={item.report} />
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
