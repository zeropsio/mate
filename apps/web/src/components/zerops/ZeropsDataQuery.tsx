/**
 * The Data panel's read-only query box: shown only by its caller
 * (`ZeropsDataPanel`) for a selected service whose
 * `resolveServiceAffordances(service).canQuery` is true, and only while the
 * toolbar's SQL toggle is open — it is a row of the panel's content column,
 * not a card of its own, so it renders as a plain bordered block.
 *
 * NOT a protected root (design-system.md R2): the submit button issues a
 * read-only `query` request directly from the user's own click, and nothing
 * here mutates — there is no agent-mutates-only boundary to keep.
 */
import { useState, type ChangeEvent } from "react";

import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";

export interface ZeropsDataQueryProps {
  readonly onSubmit: (stmt: string) => void;
}

export function ZeropsDataQuery({ onSubmit }: ZeropsDataQueryProps) {
  const [stmt, setStmt] = useState("");

  const handleChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    setStmt(event.target.value);
  };

  const handleSubmit = () => {
    if (stmt.trim().length === 0) return;
    onSubmit(stmt);
  };

  return (
    <div
      className="shrink-0 space-y-1 rounded-[var(--zerops-card-radius)] border border-border p-2"
      data-zerops-data-query
    >
      <Textarea
        data-zerops-data-query-input
        onChange={handleChange}
        placeholder="Read-only SQL — SELECT only"
        size="sm"
        value={stmt}
      />
      <Button
        data-zerops-data-query-submit
        disabled={stmt.trim().length === 0}
        onClick={handleSubmit}
        size="sm"
        variant="secondary"
      >
        Run
      </Button>
    </div>
  );
}
