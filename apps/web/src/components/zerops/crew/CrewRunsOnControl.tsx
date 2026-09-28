/**
 * A crewmate chat's composer footer (PRD §2.3 *Runs on*): what the crewmate
 * runs on, read-only — its model and effort are its own, not this message's,
 * and the crew gate decides its permissions — and the way to change them, its
 * crewmate editor.
 */
import { Button } from "../../ui/button";

export function CrewRunsOnControl({
  label,
  onEdit,
}: {
  /** `crewRunsOnWord`: "Runs on Claude Code · Haiku 4.5 · high". */
  readonly label: string;
  readonly onEdit: () => void;
}) {
  return (
    <Button
      aria-label={`${label} — edit in the crewmate editor`}
      className="-ms-2.5 min-w-0"
      data-crew-runs-on
      onClick={onEdit}
      size="xs"
      variant="ghost-muted"
    >
      <span className="truncate">{label}</span>
    </Button>
  );
}
