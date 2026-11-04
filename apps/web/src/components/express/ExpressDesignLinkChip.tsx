/**
 * An Adobe Express design's address in a conversation, drawn as the design it names and the way to
 * continue it here: the Express tab beside the conversation opens on it. A link the app cannot take
 * (no Adobe key in this build, no conversation, not a design's address) renders unchanged.
 */
import { PanelRightIcon } from "lucide-react";
import { useContext, type ReactNode } from "react";

import { useMateImage } from "~/assets/MateImages";
import { AppLinkContext } from "../ServiceBrowserLink";
import { ExpressMark } from "./ExpressMark";
import { expressDesignId } from "./expressOpen";
import { ExpressHistoryContext } from "./useExpressHistory";

/** A card's picture: 36 px at twice the pixels. */
const CARD_PICTURE = { width: 72, height: 72 } as const;

export function ExpressDesignLinkChip({
  href,
  words,
  children,
}: {
  readonly href: string | undefined;
  /** The link's own words, the design's name in the sentence the Mate wrote around it. */
  readonly words?: ReactNode;
  readonly children: ReactNode;
}) {
  const openInApp = useContext(AppLinkContext);
  const documentId = href === undefined ? null : expressDesignId(href);
  // The newest picture the person saved from this design, in this conversation.
  const { environmentId, history } = useContext(ExpressHistoryContext);
  const saved = history.find(
    (entry) => entry.kind === "picture" && entry.documentId === documentId,
  );
  const preview = useMateImage(
    environmentId === null || saved?.kind !== "picture"
      ? null
      : { environmentId, resource: saved.picture, rendition: CARD_PICTURE },
  ).url;
  const open = documentId === null ? null : (openInApp?.(href ?? "") ?? null);
  if (open === null || documentId === null) return children;
  // The design's own id, its last characters: two unnamed designs never read the same.
  const shortId = documentId.slice(-7);
  return (
    <a
      className="group/express my-1 flex w-fit max-w-full items-center gap-3 rounded-xl border border-border bg-card py-2 ps-2 pe-3 no-underline shadow-xs/5 transition-colors hover:bg-accent/60"
      data-express-design-chip
      href={href}
      onClick={(event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        open();
      }}
      rel="noopener noreferrer"
      target="_blank"
    >
      {preview === undefined ? (
        <ExpressMark className="size-9 shrink-0 rounded-lg" />
      ) : (
        <span className="relative size-9 shrink-0">
          <img
            alt=""
            className="size-9 rounded-lg border border-border object-cover"
            src={preview}
          />
          <ExpressMark className="absolute -right-1 -bottom-1 size-4 rounded-sm ring-2 ring-card" />
        </span>
      )}
      <span className="flex min-w-0 flex-col">
        <span className="truncate text-sm font-medium leading-5 text-foreground">
          {words ?? "Adobe Express design"}
        </span>
        <span className="text-xs leading-4 text-muted-foreground">
          {words === undefined ? (
            <>
              Open in the side panel · <span className="font-mono">{shortId}</span>
            </>
          ) : (
            "Open in the side panel"
          )}
        </span>
      </span>
      <PanelRightIcon
        aria-hidden="true"
        className="ms-3 size-4 shrink-0 text-muted-foreground transition-colors group-hover/express:text-foreground"
      />
    </a>
  );
}
