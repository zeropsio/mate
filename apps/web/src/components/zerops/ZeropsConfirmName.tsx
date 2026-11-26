/**
 * The one field that asks a name typed before something is deleted. The exact, copyable name is
 * set in the sentence; under the field one line says its state or what else holds Delete.
 */
import { CheckIcon } from "lucide-react";
import { useId } from "react";

import { Badge } from "~/components/ui/badge";
import { CopyButton } from "~/components/ui/copy-button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "~/components/ui/input-group";
import { Text } from "~/components/ui/text";
import { confirmNameWords } from "./ZeropsDeleteMateDialog.logic";

export function ZeropsConfirmName({
  name,
  subject,
  typed,
  onTyped,
  pending,
  hold,
  autoFocus = false,
}: {
  readonly name: string;
  readonly subject: "project" | "Mate";
  readonly typed: string;
  readonly onTyped: (typed: string) => void;
  readonly pending: boolean;
  /** What else holds Delete once the name matches (for example, an unslid Production); null: nothing. */
  readonly hold?: string | null;
  readonly autoFocus?: boolean;
}) {
  const id = useId();
  const words = confirmNameWords({ name, typed, hold: hold ?? null });
  return (
    <div className="flex flex-col gap-1.5" data-zerops-surface="confirm-name">
      <Text render={<p />} variant="description">
        Type{" "}
        <Text chip className="whitespace-pre-wrap" variant="code">
          {name}
        </Text>{" "}
        <CopyButton label={`the name ${name}`} value={name} /> to delete this {subject}.
      </Text>
      <InputGroup>
        <InputGroupInput
          aria-describedby={`${id}-hint`}
          aria-label={words.label}
          autoComplete="off"
          autoFocus={autoFocus}
          id={`${id}-name`}
          onChange={(event) => {
            onTyped(event.target.value);
          }}
          readOnly={pending}
          spellCheck={false}
          value={typed}
        />
        {words.state === "held" || words.state === "matches" ? (
          <InputGroupAddon align="inline-end">
            <CheckIcon aria-hidden="true" className="text-status-ok-text" />
          </InputGroupAddon>
        ) : null}
      </InputGroup>
      <div aria-live="polite" className="flex min-h-5 items-center" id={`${id}-hint`}>
        <Text variant="note">
          {words.state === "matches" ? (
            <Badge dot tone="success">
              {words.line}
            </Badge>
          ) : (
            words.line
          )}
        </Text>
      </div>
    </div>
  );
}
