import type { AgentAdmissionAttention } from "@t3tools/client-runtime/data";
import { TriangleAlertIcon } from "lucide-react";
import { Alert, AlertAction } from "../ui/alert";
import { Button } from "../ui/button";

/**
 * One nondismissible explanation beside the input it gates, set into the composer's top the way
 * its asks are: its mark, its words, its one press at the end and a rule under it, never a card of
 * its own inside the composer. Settings owns the repair controls.
 */
export function AgentAdmissionExplanation({
  attention,
  onAction,
}: {
  readonly attention: AgentAdmissionAttention | null;
  readonly onAction: () => void;
}) {
  if (attention === null) return null;
  return (
    <div
      id="agent-admission"
      tabIndex={-1}
      data-agent-admission={attention.key}
      className="border-rule border-b py-3 ps-4 pe-2 text-line leading-4.5"
    >
      <Alert
        controlAlignment="first-line"
        icon={<TriangleAlertIcon aria-hidden="true" />}
        role="status"
        surface="bare"
        variant="warning"
      >
        {attention.text}
        <AlertAction>
          <Button
            data-zerops-primary-action="Authorize"
            size="sm"
            variant="primary"
            onClick={onAction}
          >
            {attention.actionLabel}
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}
