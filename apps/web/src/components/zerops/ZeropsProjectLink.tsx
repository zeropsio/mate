import { Button } from "../ui/button";
import { ZeropsMark } from "../ZeropsMark";

/**
 * The way into Zerops from a Mate's conversation: its project on the
 * dashboard, in a new tab. It stands where the editor picker stands in a
 * conversation on a machine of one's own — the header's one button style,
 * the Zerops loop, and the label only where the header has room for it.
 */
export function ZeropsProjectLink({ projectUrl }: { readonly projectUrl: string }) {
  return (
    <Button
      data-chat-header-ghost
      render={
        <a aria-label="Open in Zerops" href={projectUrl} rel="noreferrer" target="_blank">
          <ZeropsMark className="size-3.5 shrink-0" />
          <span className="hidden text-line @3xl/header-actions:inline">Open in Zerops</span>
        </a>
      }
      size="sm"
      variant="ghost-muted"
    />
  );
}
