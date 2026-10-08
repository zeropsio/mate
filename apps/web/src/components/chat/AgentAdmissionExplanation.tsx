import type { AgentAdmissionAttention } from "@t3tools/client-runtime/data";
import { Alert, AlertAction, AlertDescription } from "../ui/alert";
import { Button } from "../ui/button";

/** One nondismissible explanation beside the input it gates. Settings owns the repair controls. */
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
      className="px-3 py-2"
    >
      <Alert variant="warning" role="status" layout="centered">
        <AlertDescription>{attention.text}</AlertDescription>
        <AlertAction>
          <Button
            data-zerops-primary-action="Authorize"
            size="compact"
            variant="pill"
            onClick={onAction}
          >
            {attention.actionLabel}
          </Button>
        </AlertAction>
      </Alert>
    </div>
  );
}
