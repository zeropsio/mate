/**
 * What automated Mates run on and take tasks from. Settings › Automation's model key — the
 * organization's API key, set, replaced or removed there, never shown back — and, per application
 * (its project's page shows it), the GitHub repository and label its automated Mates take issues
 * from, with what HQ answered as it was set: the webhook it made, or the URL and secret to paste,
 * the secret shown this once.
 */
import type { OrgAiKeysRead } from "@t3tools/client-runtime/data";
import type { OPENCODE_KEY_PROVIDERS } from "@t3tools/shared/openCodeKeyProviders";
import { useId, useState } from "react";

import { KeyRoundIcon } from "lucide-react";

import { Button, InlineButton } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { aiKeyLine } from "./automatedMatesSettings.logic";
import { IntegrationAction, IntegrationRow } from "./IntegrationRow";
import { searchableSetting } from "./settingsSearch";
import { AppIntakeView } from "../zerops/projectAutomation/sourceForms";

// A project's GitHub issues form lives on its page (`projectAutomation/sourceForms`); importable from here.
export { AppIntakeView };

const day = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

/** In the settings' place, where this HQ can't do automated Mates. */
export function AutomatedMatesUnsupported() {
  return (
    <p
      className="px-3 pb-3 text-sm text-muted-foreground sm:px-4"
      data-zerops-surface="settings-automated-unsupported"
    >
      Update HQ to set up automated Mates.
    </p>
  );
}

/** The organization's key for one provider: its row, from what is read. */
export function OrganizationKeyView({
  provider,
  read,
  onSet,
  onRemove,
  onAgain,
}: {
  readonly provider: (typeof OPENCODE_KEY_PROVIDERS)[number];
  readonly read: OrgAiKeysRead;
  readonly onSet: (provider: string, value: string) => void;
  readonly onRemove: (provider: string) => void;
  readonly onAgain: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const keyId = useId();
  const view =
    read.keys.state === "known"
      ? read.keys.keys.find((key) => key.provider === provider.id)
      : undefined;
  const known = read.keys.state === "known";
  const set = view?.set === true;
  const working = read.action.kind === "working";
  const problem =
    read.action.kind === "failed" || read.action.kind === "unresolved" ? read.action.words : null;
  // One line, whatever lands: a refusal, a write under way, or where the key stands.
  const line =
    problem !== null ? (
      <span className="text-destructive-foreground" role="alert">
        {problem}
      </span>
    ) : read.keys.state === "failed" ? (
      read.keys.words
    ) : read.keys.state === "withheld" ? (
      "Only the organization's Owner and Admins see its key."
    ) : working ? (
      read.action.kind === "working" && read.action.verb === "remove" ? (
        "Removing…"
      ) : (
        "Saving…"
      )
    ) : set ? (
      `${provider.name} · ${aiKeyLine(view, day)}`
    ) : (
      `Your ${provider.name} key pays for the open models automated Mates run.`
    );
  const close = () => {
    setEditing(false);
    setValue("");
  };
  return (
    <IntegrationRow
      action={
        read.keys.state === "failed" ? (
          <Button onClick={onAgain} size="sm" variant="secondary">
            Read again
          </Button>
        ) : known ? (
          <IntegrationAction
            disabled={working}
            onToggle={() => {
              if (editing) close();
              else setEditing(true);
            }}
            open={editing}
            primary={!set}
          >
            {set ? "Replace" : "Add key"}
          </IntegrationAction>
        ) : undefined
      }
      id={searchableSetting("automation-model-key").id}
      line={line}
      mark={<KeyRoundIcon className="size-5" />}
      name="Model key"
      open={editing && known}
      state={
        known
          ? set
            ? { kind: "on", words: "Set" }
            : { kind: "off", words: "Not set" }
          : read.keys.state === "failed" || read.keys.state === "withheld"
            ? { kind: "none" }
            : { kind: "checking" }
      }
      surface="settings-org-ai-key"
    >
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const typed = value.trim();
          if (typed.length === 0) return;
          close();
          onSet(provider.id, typed);
        }}
      >
        <Label htmlFor={keyId}>{provider.name} API key</Label>
        <Input
          aria-describedby={`${keyId}-hint`}
          autoComplete="off"
          autoFocus
          id={keyId}
          onChange={(event) => {
            setValue(event.target.value);
          }}
          size="sm"
          spellCheck={false}
          type="password"
          value={value}
        />
        {/* The Mates' agents can reach the key: one made for Mate alone, with a limit. */}
        <p className="text-xs text-muted-foreground" id={`${keyId}-hint`}>
          Use a key made only for Mate, with a spending limit. HQ keeps it sealed and never shows it
          again.
        </p>
        <div className="flex items-center gap-2">
          <Button disabled={value.trim().length === 0} size="sm" type="submit">
            Save key
          </Button>
          {set ? (
            <span className="ms-auto text-xs">
              <InlineButton
                onClick={() => {
                  close();
                  onRemove(provider.id);
                }}
                tone="destructive"
              >
                Remove key
              </InlineButton>
            </span>
          ) : null}
        </div>
      </form>
    </IntegrationRow>
  );
}
