/**
 * A crew seam (PRD §4.5, design-system *Seams*): one quiet line across the
 * conversation where something about the crewmate changed — "Started fresh
 * by you — previous conversation ↗". Drawn like a day line; a link in it acts
 * in the action blue.
 */
export function CrewSeamLine({
  text,
  link,
}: {
  readonly text: string;
  readonly link?: { readonly label: string; readonly onOpen: () => void } | undefined;
}) {
  return (
    <div
      className="flex items-center gap-3 text-xs text-muted-foreground"
      data-crew-seam
      {...(link === undefined ? { "aria-label": text, role: "separator" } : {})}
    >
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      <span className="flex shrink-0 items-baseline gap-1">
        <span>{text}</span>
        {link === undefined ? null : (
          <>
            <span aria-hidden="true">—</span>
            <button
              className="cursor-pointer text-message-action hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring"
              onClick={link.onOpen}
              type="button"
            >
              {link.label} ↗
            </button>
          </>
        )}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}
