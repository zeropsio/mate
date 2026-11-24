/**
 * An Adobe Express design's address in a conversation, drawn as the design it names and the way to
 * continue it here: the Express tab beside the conversation opens on it. A link the app cannot take
 * (Express off, no conversation, not a design's address) renders unchanged.
 */
import { PanelRightIcon } from "lucide-react";
import { useContext, type ReactNode } from "react";

import { useMateImage } from "~/assets/MateImages";
import { AppLinkContext } from "../ServiceBrowserLink";
import { Row } from "../ui/row";
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
  const open = href === undefined || documentId === null ? null : (openInApp?.(href) ?? null);
  // Only a design's address reads pictures: every other link renders back without a subscription.
  if (open === null || documentId === null || href === undefined) return children;
  return <ExpressDesignCard documentId={documentId} href={href} open={open} words={words} />;
}

function ExpressDesignCard({
  documentId,
  href,
  open,
  words,
}: {
  readonly documentId: string;
  readonly href: string;
  readonly open: () => void;
  readonly words: ReactNode | undefined;
}) {
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
  // The design's own id, its last characters: two unnamed designs never read the same.
  const shortId = documentId.slice(-7);
  return (
    <span className="my-1 flex w-fit max-w-full rounded-xl border border-border bg-card shadow-xs/5">
      <Row
        className="group/express"
        data-express-design-chip
        lead={
          preview === undefined ? (
            <ExpressMark className="size-8 rounded-lg" />
          ) : (
            <>
              <img
                alt=""
                className="size-8 rounded-lg border border-border object-cover"
                src={preview}
              />
              <ExpressMark className="absolute -right-1 -bottom-1 size-4 rounded-sm ring-2 ring-card" />
            </>
          )
        }
        line={
          words === undefined ? (
            <>
              Open in the side panel · <span className="font-mono">{shortId}</span>
            </>
          ) : (
            "Open in the side panel"
          )
        }
        meta={
          <PanelRightIcon
            aria-hidden="true"
            className="ms-3 size-4 transition-colors group-hover/express:text-foreground"
          />
        }
        pressable
        render={
          <a
            href={href}
            onClick={(event) => {
              if (
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
              )
                return;
              event.preventDefault();
              open();
            }}
            rel="noopener noreferrer"
            target="_blank"
          />
        }
        title={words ?? "Adobe Express design"}
      />
    </span>
  );
}
