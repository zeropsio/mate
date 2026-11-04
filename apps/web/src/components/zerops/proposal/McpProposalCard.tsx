/**
 * A Mate's proposal to connect an MCP server, drawn from its view model (`mcpProposalView`): what
 * it is, where it connects and how it signs in, the Mate's reason in its words, then each step
 * the person takes now — masked fields typed here, never in the chat; Add; Sign in, with the paste
 * fallback — and one outcome line. Built from the proposal and vault-ask cards' own pieces; props
 * only: the container carries everything out.
 */
import { CheckIcon, CircleAlertIcon, EyeIcon, EyeOffIcon, PlugIcon } from "lucide-react";
import { useState } from "react";

import { Button, InlineButton } from "../../ui/button";
import { Card } from "../../ui/card";
import { Input } from "../../ui/input";
import { Spinner } from "../../ui/spinner";
import type { McpProposalStep, McpProposalView } from "./mcpProposal.logic";

export interface McpProposalCardProps {
  readonly view: McpProposalView;
  readonly busy?: boolean;
  readonly refusal?: string | undefined;
  /** Adds it with the values the person typed, by field key. */
  readonly onAdd?: (values: Readonly<Record<string, string>>) => void;
  readonly onDecline?: () => void;
  readonly onSignIn?: () => void;
  readonly onOpenAgain?: (url: string) => void;
  /** Finishes a sign-in with the address the browser landed on. */
  readonly onFinishSignIn?: (landed: string) => void;
}

const SIGN_IN_MATE =
  "Finish signing in on the page that opened. This card updates when you come back.";
const SIGN_IN_PASTE =
  "After you sign in, the browser lands on a page that doesn't load. Copy that page's address and paste it here.";

export function McpProposalCard(props: McpProposalCardProps) {
  const { view } = props;
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});
  const provide = view.steps.find(
    (step): step is Extract<McpProposalStep, { kind: "provide" }> => step.kind === "provide",
  );
  const typed = provide?.fields.every((field) => (values[field.key] ?? "").trim() !== "") ?? true;
  return (
    <Card data-mcp-proposal={view.title} size="sm" variant="flat">
      <div className="flex min-w-0 items-start gap-2.5">
        <PlugIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="grid min-w-0 flex-1 gap-2.5">
          <div className="grid min-w-0 gap-0.5">
            <p className="text-sm font-medium text-foreground">{view.title}</p>
            <p className="min-w-0 truncate text-xs text-muted-foreground">{view.connects}</p>
            {view.signsIn === null ? null : (
              <p className="text-xs text-muted-foreground">{view.signsIn}</p>
            )}
            {view.reason === null ? null : (
              <p className="text-xs leading-4.5 text-muted-foreground">
                {view.proposer}: <q className="italic">{view.reason}</q>
              </p>
            )}
            {view.scopeLine === null ? null : (
              <p className="text-xs leading-4.5 text-muted-foreground">{view.scopeLine}</p>
            )}
          </div>
          {view.steps.map((step) => {
            switch (step.kind) {
              case "provide":
                return (
                  <div className="grid min-w-0 gap-1.5" key="provide">
                    {step.fields.map((field) => (
                      <SecretField
                        disabled={props.busy === true}
                        key={field.key}
                        label={field.label}
                        onChange={(value) =>
                          setValues((current) => ({ ...current, [field.key]: value }))
                        }
                        value={values[field.key] ?? ""}
                        where={field.where}
                      />
                    ))}
                  </div>
                );
              case "approve":
                return (
                  <div className="flex flex-wrap items-center gap-2" key="approve">
                    <Button
                      disabled={step.blocked !== null || !typed || props.busy === true}
                      onClick={() => props.onAdd?.(values)}
                      size="sm"
                    >
                      {props.busy === true ? <Spinner size="xs" /> : null}
                      {step.label}
                    </Button>
                    <Button
                      disabled={props.busy === true}
                      onClick={props.onDecline}
                      size="sm"
                      variant="ghost"
                    >
                      Decline
                    </Button>
                    {step.blocked === null ? null : (
                      <span className="text-xs text-muted-foreground">{step.blocked}</span>
                    )}
                  </div>
                );
              case "connect":
                return <ConnectStep key="connect" props={props} step={step} />;
            }
          })}
          {props.refusal === undefined ? null : (
            <p
              className="flex items-start gap-1.5 text-xs leading-4 text-destructive-foreground"
              role="alert"
            >
              <CircleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
              {props.refusal}
            </p>
          )}
          {view.outcome === null ? null : (
            <p
              className={
                view.outcome.tone === "failed"
                  ? "flex items-start gap-1.5 text-xs leading-4 text-destructive-foreground"
                  : "flex min-h-6 items-center gap-1.5 text-xs text-muted-foreground"
              }
              data-mcp-proposal-outcome={view.outcome.tone}
              role={view.outcome.tone === "failed" ? "alert" : "status"}
            >
              {view.outcome.tone === "working" ? <Spinner size="xs" /> : null}
              {view.outcome.tone === "done" ? (
                <CheckIcon aria-hidden="true" className="size-3.5 shrink-0 text-status-ok-text" />
              ) : null}
              {view.outcome.tone === "failed" || view.outcome.tone === "attention" ? (
                <CircleAlertIcon aria-hidden="true" className="size-3.5 shrink-0" />
              ) : null}
              <span className="min-w-0 wrap-anywhere">{view.outcome.words}</span>
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

/** One key the person types: masked until they show it, as the vault ask's field is. */
function SecretField(props: {
  readonly label: string;
  readonly where: string;
  readonly value: string;
  readonly disabled: boolean;
  readonly onChange: (value: string) => void;
}) {
  const [shown, setShown] = useState(false);
  return (
    <div className="grid min-w-0 gap-0.5">
      <div className="flex min-w-0 items-center gap-1">
        <Input
          aria-label={props.label}
          autoComplete="new-password"
          data-1p-ignore=""
          data-bwignore=""
          data-form-type="other"
          data-lpignore="true"
          disabled={props.disabled}
          onChange={(event) => props.onChange(event.currentTarget.value)}
          placeholder={props.label}
          size="sm"
          spellCheck={false}
          type={shown ? "text" : "password"}
          value={props.value}
        />
        <Button
          aria-label={shown ? "Hide" : "Show"}
          aria-pressed={shown}
          onClick={() => setShown((current) => !current)}
          size="icon-sm"
          variant="ghost"
        >
          {shown ? <EyeOffIcon /> : <EyeIcon />}
        </Button>
      </div>
      <span className="text-xs text-muted-foreground">
        {props.where} — it goes to the Mate, not the chat
      </span>
    </div>
  );
}

function ConnectStep({
  props,
  step,
}: {
  readonly props: McpProposalCardProps;
  readonly step: Extract<McpProposalStep, { kind: "connect" }>;
}) {
  const [landed, setLanded] = useState("");
  const { signing } = step;
  if (signing.phase === "mate") {
    return (
      <p className="text-xs leading-4.5 text-muted-foreground">
        {SIGN_IN_MATE}{" "}
        <InlineButton onClick={() => props.onOpenAgain?.(signing.url)} tone="muted">
          Open it again
        </InlineButton>
      </p>
    );
  }
  if (signing.phase === "paste") {
    return (
      <form
        className="grid min-w-0 gap-1.5"
        onSubmit={(event) => {
          event.preventDefault();
          if (landed.trim() !== "") props.onFinishSignIn?.(landed.trim());
        }}
      >
        <span className="text-xs text-muted-foreground">{SIGN_IN_PASTE}</span>
        <div className="flex min-w-0 items-center gap-2">
          <Input
            aria-label={SIGN_IN_PASTE}
            disabled={signing.finishing}
            onChange={(event) => setLanded(event.currentTarget.value)}
            placeholder="http://localhost:…/callback?code=…"
            size="sm"
            spellCheck={false}
            value={landed}
          />
          <Button disabled={signing.finishing || landed.trim() === ""} size="sm" type="submit">
            {signing.finishing ? <Spinner size="xs" /> : null}
            Finish
          </Button>
        </div>
      </form>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button disabled={signing.phase === "starting"} onClick={props.onSignIn} size="sm">
        {signing.phase === "starting" ? <Spinner size="xs" /> : null}
        {step.label}
      </Button>
      <span className="text-xs text-muted-foreground">as {step.agent}</span>
    </div>
  );
}
