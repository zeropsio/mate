/**
 * A Mate's proposal to connect an MCP server, on the ask card (`mcpProposalView`, `mcpAskFace`):
 * where it connects and how it signs in, the Mate's why in its words, adding then signing in as
 * numbered steps where it signs in when asked, each key the person types — masked, never in the
 * chat —, their own app's client ID and where it sends each agent back, which agents can't use it,
 * and the paste fallback when the browser can't come back. `full` in the conversation, `compact`
 * above the composer while the Mate waits on it. Props only: the container carries everything out.
 */
import { CircleAlertIcon } from "lucide-react";
import { type ReactNode, useState } from "react";

import { AskCard, AskFacts, AskFooter, AskSteps, type AskDensity } from "../../ask/AskCard";
import { AskSecretField } from "../../ask/AskSecret";
import { Button } from "../../ui/button";
import { Input } from "../../ui/input";
import type {
  McpAskFace,
  McpProposalStep,
  McpProposalView,
  McpSigning,
  mcpProgress,
} from "./mcpProposal.logic";

export interface McpProposalCardProps {
  readonly askId: string;
  readonly density?: AskDensity;
  readonly view: McpProposalView;
  readonly face: McpAskFace;
  readonly progress?: ReturnType<typeof mcpProgress>;
  readonly signing?: McpSigning;
  /** Compact: the asking Mate's face. */
  readonly mateFace?: ReactNode;
  readonly refusal?: string | undefined;
  /** Adds it with the values the person typed, by field key. */
  readonly onAdd?: (values: Readonly<Record<string, string>>) => void;
  readonly onDecline?: () => void;
  readonly onSignIn?: () => void;
  readonly onOpenAgain?: (url: string) => void;
  /** Finishes a sign-in with the address the browser landed on. */
  readonly onFinishSignIn?: (landed: string) => void;
  /** Replaces the key it was added with, by field key; resolves once the Mate took it. */
  readonly onChangeKey?: (values: Readonly<Record<string, string>>) => Promise<boolean>;
  /** Starts it again after a failure. */
  readonly onTryAgain?: () => void;
  readonly onShowInConversation?: (() => void) | undefined;
}

const SIGN_IN_PASTE =
  "After you sign in, the browser lands on a page that doesn't load. Copy that page's address and paste it here.";

export function McpProposalCard(props: McpProposalCardProps) {
  const { view, face } = props;
  const density = props.density ?? "full";
  const full = density === "full";
  const size = full ? "md" : "sm";
  const [values, setValues] = useState<Readonly<Record<string, string>>>({});
  const [landed, setLanded] = useState("");
  // "Change key" asks for the keys again, masked: a new one replaces the stored one.
  const [changing, setChanging] = useState(false);
  const [saving, setSaving] = useState(false);
  const provide = changing
    ? { kind: "provide" as const, fields: view.keys }
    : view.steps.find(
        (step): step is Extract<McpProposalStep, { kind: "provide" }> => step.kind === "provide",
      );
  const approve = view.steps.find(
    (step): step is Extract<McpProposalStep, { kind: "approve" }> => step.kind === "approve",
  );
  const typed =
    provide?.fields.every((field) => field.optional || (values[field.key] ?? "").trim() !== "") ??
    true;
  const working = face.state.kind === "working";
  const signing = props.signing ?? { phase: "idle" };
  const pasting = signing.phase === "paste";

  const saveKey = async () => {
    if (!typed || saving) return;
    setSaving(true);
    const saved = (await props.onChangeKey?.(values)) ?? false;
    setSaving(false);
    if (saved) {
      setValues({});
      setChanging(false);
    }
  };
  const press = () => {
    if (changing) {
      void saveKey();
      return;
    }
    switch (face.main?.does) {
      case "add":
        props.onAdd?.(values);
        return;
      case "signIn":
        props.onSignIn?.();
        return;
      case "finish":
        if (landed.trim() !== "") props.onFinishSignIn?.(landed.trim());
    }
  };
  const disabled =
    face.main?.does === "add"
      ? (approve?.blocked ?? null) !== null || !typed
      : face.main?.does === "finish"
        ? landed.trim() === ""
        : false;
  const note =
    face.main?.does === "add" ? (approve?.blocked ?? undefined) : (face.note ?? undefined);

  const action =
    face.action === "openAgain" && signing.phase === "mate" ? (
      <Button onClick={() => props.onOpenAgain?.(signing.url)} size={size} variant="secondary">
        Open it again
      </Button>
    ) : face.action === "signInAgain" ? (
      <Button onClick={props.onSignIn} size={size} variant="secondary">
        Sign in again
      </Button>
    ) : face.action === "changeKey" ? (
      <Button onClick={() => setChanging(true)} size={size} variant="secondary">
        Change key
      </Button>
    ) : face.action === "tryAgain" ? (
      <Button onClick={props.onTryAgain} size={size} variant="secondary">
        Try again
      </Button>
    ) : undefined;
  // Changing the key, the card asks for it again in place of the failure, until it is saved.
  const footerState: McpAskFace["state"] = changing
    ? saving
      ? { kind: "working", words: "Saving the key…", pressed: "main" }
      : { kind: "waiting" }
    : face.state;
  const footerMain = changing
    ? { label: "Save the key", onPress: press, disabled: !typed }
    : face.main === null
      ? null
      : { label: face.main.label, onPress: press, disabled };

  const fields =
    provide === undefined
      ? null
      : provide.fields.map((field) =>
          field.hidden ? (
            <AskSecretField
              density={density}
              disabled={working || saving}
              hint={full ? `${field.where} — it goes to the Mate, not the chat` : undefined}
              key={field.key}
              label={field.label}
              onEnter={press}
              onValue={(value) => setValues((current) => ({ ...current, [field.key]: value }))}
              value={values[field.key] ?? ""}
            />
          ) : (
            <label
              className="grid min-w-0 gap-1.5 text-caption text-muted-foreground"
              key={field.key}
            >
              {full ? field.label : null}
              <Input
                aria-label={field.label}
                disabled={working}
                onChange={(event) => {
                  const value = event.currentTarget.value;
                  setValues((current) => ({ ...current, [field.key]: value }));
                }}
                placeholder={full ? undefined : field.label}
                size="sm"
                spellCheck={false}
                value={values[field.key] ?? ""}
              />
            </label>
          ),
        );

  const paste = pasting ? (
    <label className="grid min-w-0 gap-1.5 text-caption text-muted-foreground">
      {SIGN_IN_PASTE}
      <Input
        aria-label={SIGN_IN_PASTE}
        disabled={signing.finishing}
        onChange={(event) => setLanded(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") press();
        }}
        placeholder="http://localhost:…/callback?code=…"
        size="sm"
        spellCheck={false}
        value={landed}
      />
    </label>
  ) : null;

  const body = full ? (
    <>
      <AskFacts
        rows={[
          {
            label: view.connects.startsWith("Runs") ? "runs" : "connects",
            value: view.connects.replace(/^(Connects to|Runs) /u, ""),
          },
          ...(view.signsIn === null ? [] : [{ label: "signs in", value: view.signsIn }]),
        ]}
      />
      {view.scopeLine === null ? null : (
        <p className="text-caption text-muted-foreground">{view.scopeLine}</p>
      )}
      {props.progress === null || props.progress === undefined ? null : (
        <AskSteps
          steps={props.progress.map((step) => ({
            id: step.id,
            label: step.label,
            ...(step.detail === null ? {} : { detail: step.detail }),
            state: step.state,
            end: step.end,
          }))}
        />
      )}
      {fields}
      {view.redirects.length === 0 ? null : (
        <div className="grid gap-1 text-caption text-muted-foreground" data-mcp-redirects>
          <span>Register these addresses in your app, so each agent is sent back:</span>
          {view.redirects.map((redirect) => (
            <span className="font-mono" key={redirect.agent}>
              {redirect.agent} · {redirect.url}
            </span>
          ))}
        </div>
      )}
      {view.cannot === null ? null : (
        <p className="text-caption text-muted-foreground" data-mcp-cannot>
          {view.cannot}
        </p>
      )}
      {paste}
      {props.refusal === undefined ? null : <Problem alert words={props.refusal} />}
    </>
  ) : fields === null && paste === null && props.refusal === undefined ? undefined : (
    <>
      {fields}
      {paste}
      {props.refusal === undefined ? null : <Problem alert words={props.refusal} />}
    </>
  );

  return (
    <div data-mcp-proposal={view.title}>
      <AskCard
        askId={props.askId}
        density={density}
        face={props.mateFace}
        footer={
          <AskFooter
            action={changing ? undefined : action}
            also={
              changing && !saving ? (
                <Button onClick={() => setChanging(false)} size={size} variant="ghost">
                  Cancel
                </Button>
              ) : undefined
            }
            density={density}
            main={footerMain}
            note={changing ? undefined : note}
            onNotNow={face.notNow && !changing ? props.onDecline : undefined}
            state={footerState}
          />
        }
        kind="mcp"
        note={full ? undefined : note}
        onShowInConversation={props.onShowInConversation}
        state={footerState.kind}
        title={view.title}
        where={{ scope: "mate", detail: null }}
        why={view.reason === null ? null : { who: view.proposer, words: view.reason }}
      >
        {body}
      </AskCard>
    </div>
  );
}

function Problem({ words }: { readonly words: string; readonly alert?: boolean }) {
  return (
    <p className="flex items-start gap-1.5 text-caption text-destructive-foreground" role="alert">
      <CircleAlertIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
      {words}
    </p>
  );
}
