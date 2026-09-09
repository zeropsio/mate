/**
 * Renders `mateUpdateLine`'s result: the installed version in the muted
 * hand, and — only when the line carries an available update — the
 * "· x.y.z available" clause in the glossary's update role (spec-mate.md
 * §2.9; design-system.md glossary: teal only as the mark, the identity
 * pill tint, "the update role", and the connected/authorized dots — never
 * the status palette's amber "attention", which names a different thing).
 *
 * The Update verb is the caller's: this component only lays the line and an
 * optional trailing verb side by side, never decides whether one is offered.
 */
import type { ReactNode } from "react";

import type { MateUpdateLine as MateUpdateLineValue } from "~/zerops/mateUpdate";

export function MateUpdateLine({
  line,
  verb,
}: {
  readonly line: MateUpdateLineValue;
  readonly verb?: ReactNode;
}) {
  const [base, suffix] = line.tone === "attention" ? splitSuffix(line.text) : [line.text, null];
  return (
    <>
      <span>
        {base}
        {suffix !== null ? (
          <span
            className="text-[var(--zerops-update-role,var(--foreground))]"
            data-zerops-surface="mate-update-role"
          >
            {" "}
            · {suffix}
          </span>
        ) : null}
      </span>
      {verb}
    </>
  );
}

function splitSuffix(text: string): [string, string | null] {
  const separator = " · ";
  const index = text.indexOf(separator);
  if (index === -1) return [text, null];
  return [text.slice(0, index), text.slice(index + separator.length)];
}
