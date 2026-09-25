import type { OperationSubject } from "./subject";

/**
 * The line under a card's verb: the service as a teal identity chip (teal
 * identifies, design-system §2), the page's path + query in mono, wrapping
 * anywhere. Before the input names the target the line is held at its
 * height by a static tint (R6: nothing animates); a settled card that never
 * learned its target says so in the reducer's own words.
 */
export function OperationSubjectLine({
  running,
  subject,
}: {
  readonly running: boolean;
  readonly subject: OperationSubject;
}) {
  return (
    <p className="min-h-5 text-xs leading-5 [overflow-wrap:anywhere]" data-zerops-operation-subject>
      {subject.kind === "named" ? (
        <>
          <span
            className="me-1.5 inline-flex rounded-[var(--zerops-chip-radius)] bg-[color-mix(in_srgb,var(--zerops-update-role)_13%,transparent)] px-1.5 font-medium text-[var(--zerops-update-role)]"
            data-zerops-identity-chip
          >
            {subject.host}
          </span>
          {subject.path !== undefined ? (
            <span className="font-mono text-muted-foreground" data-zerops-subject-path>
              {subject.path}
            </span>
          ) : null}
        </>
      ) : running ? (
        <span
          aria-hidden="true"
          className="inline-block h-3 w-28 rounded-sm bg-muted align-middle"
          data-zerops-subject-placeholder
        />
      ) : (
        <span className="text-muted-foreground">{subject.text}</span>
      )}
    </p>
  );
}
