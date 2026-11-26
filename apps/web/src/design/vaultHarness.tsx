/**
 * The Vault tab in the right panel as the app lays it out at the owner's size: 1786 wide, the
 * left menu at 435 (`?menu=` for another), the panel at its default 540 beside the conversation.
 *
 * The real `VaultPanelBody` in the real `RightPanelTabs`, over the fixture view
 * (`vaultFixture.ts`). `?state=` — `ready` (the default), `unread` (reading), `failed` (what it
 * kept, under the failure), `failed-empty` (a read that failed before any answer), `live` (nothing
 * waits), `apps` (two apps with values of their own), `mate` (the Mate's own vault holds values),
 * `composer` (the message box's key card over a message: *Add to message* puts the key in it).
 * `?actor=environment` draws it without a Mate (restart buttons). Writes answer after
 * 600 ms; `?fail=1` refuses each with `projectEnvDuplicateKey`. `?theme=dark` for dark.
 *
 * Served by the dev server at `/design-vault.html`. Fixtures only: nothing here ships, and no
 * route imports this module.
 */
import type { VaultView } from "@t3tools/client-runtime/data";
import { KeyRoundIcon } from "lucide-react";
import { StrictMode, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";

import {
  ComposerPromptEditor,
  ComposerVaultKeysContext,
  type ComposerPromptEditorHandle,
} from "~/components/ComposerPromptEditor";
import { RightPanelPage } from "~/components/RightPanelPage";
import { RightPanelTabs } from "~/components/RightPanelTabs";
import type { RightPanelSurface } from "~/rightPanelStore";
import { Button } from "~/components/ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "~/components/ui/popover";
import { VaultAddCard } from "~/components/zerops/vault/VaultEditors";
import { VaultPanelBody } from "~/components/zerops/vault/VaultPanel";
import { vaultName } from "~/components/zerops/vault/vault.logic";
import {
  VAULT_FIXTURE,
  VAULT_MATE_FIXTURE,
  VAULT_TWO_APPS_FIXTURE,
  vaultFixtureImpact,
} from "~/components/zerops/vault/vaultFixture";
import { VAULT_STORE_FIXTURE } from "~/components/zerops/vault/vaultStoreFixture";
import { resolveRightPanelAvailability } from "~/rightPanelKinds";
import "../index.css";

const params = new URLSearchParams(location.search);
const STATE = params.get("state") ?? "ready";
const ACTOR = params.get("actor") === "environment" ? "environment" : "mate";
const FAIL = params.get("fail") === "1";
const MENU = Number(params.get("menu") ?? 435);
const noop = () => {};

const VIEWS: Record<string, VaultView> = {
  ready: VAULT_FIXTURE,
  unread: { status: "unread", complete: false, scopes: [], notLive: [] },
  failed: { ...VAULT_FIXTURE, status: "failed" },
  "failed-empty": { status: "failed", complete: false, scopes: [], notLive: [] },
  live: { ...VAULT_FIXTURE, notLive: [] },
  apps: VAULT_TWO_APPS_FIXTURE,
  mate: VAULT_MATE_FIXTURE,
};
const VIEW = params.get("data") === "store" ? VAULT_STORE_FIXTURE : (VIEWS[STATE] ?? VAULT_FIXTURE);

/** `?tabs=many`: the ten tabs a stress run opened, more than the panel's strip holds. */
const MANY_TABS = params.get("tabs") === "many";
const TEN_TABS: RightPanelSurface[] = [
  { id: "browser", kind: "browser" },
  {
    id: "terminal:1",
    kind: "terminal",
    resourceId: "1",
    terminalIds: ["1"],
    activeTerminalId: "1",
  },
  { id: "files", kind: "files" },
  { id: "git", kind: "git" },
  { id: "zerops", kind: "zerops" },
  { id: "data", kind: "data" },
  { id: "mcp", kind: "mcp" },
  { id: "vault", kind: "vault" },
  { id: "agents", kind: "agents" },
];

const TYPED = "Here is the key for the checkout's payments: ";

/** The message box with its key card open, as the person's key button opens it in Fen's conversation. */
function ComposerKeyHarness() {
  const editorRef = useRef<ComposerPromptEditorHandle>(null);
  const [value, setValue] = useState(TYPED);
  const [cursor, setCursor] = useState(TYPED.length);
  const [open, setOpen] = useState(true);
  const scopes = useMemo(
    () => [
      ...VAULT_MATE_FIXTURE.scopes.filter((scope) => scope.editable && scope.kind === "mate"),
      ...VAULT_MATE_FIXTURE.scopes.filter((scope) => scope.editable && scope.kind !== "mate"),
    ],
    [],
  );
  const [keys, setKeys] = useState<ReadonlyMap<string, string>>(
    () =>
      new Map(
        scopes.flatMap((scope) =>
          scope.values.map((held) => [held.key, vaultName(scope, "Fen")] as const),
        ),
      ),
  );
  return (
    <div
      className="flex h-screen items-end justify-center bg-background p-10 text-foreground"
      data-harness-state="composer"
    >
      <div className="w-190 rounded-sheet border border-border bg-card px-4 pt-4 pb-3 shadow-lg/5">
        <ComposerVaultKeysContext value={keys}>
          <ComposerPromptEditor
            editorRef={editorRef}
            value={value}
            cursor={cursor}
            terminalContexts={[]}
            skills={[]}
            disabled={false}
            placeholder="Ask Fen…"
            onRemoveTerminalContext={noop}
            onChange={(next, nextCursor) => {
              setValue(next);
              setCursor(nextCursor);
            }}
            onPaste={noop}
          />
        </ComposerVaultKeysContext>
        <div className="flex justify-end">
          <Popover onOpenChange={setOpen} open={open}>
            <PopoverTrigger
              render={
                <Button aria-label="Add a value to the vault" size="icon-sm" variant="ghost" />
              }
            >
              <KeyRoundIcon aria-hidden="true" />
            </PopoverTrigger>
            <PopoverPopup align="end" padding="none" side="top" sideOffset={8} width="lg">
              <VaultAddCard
                busy={false}
                forMessage
                framed={false}
                mateName="Fen"
                onAdd={(scope, change) => {
                  setKeys((held) => new Map([...held, [change.key, vaultName(scope, "Fen")]]));
                  const before = value[cursor - 1];
                  const lead = before === undefined || /\s/.test(before) ? "" : " ";
                  const text = `${lead}$${change.key} `;
                  setValue(`${value.slice(0, cursor)}${text}${value.slice(cursor)}`);
                  setCursor(cursor + text.length);
                  setOpen(false);
                }}
                onCancel={() => setOpen(false)}
                refusal={null}
                scopes={scopes}
              />
            </PopoverPopup>
          </Popover>
        </div>
      </div>
    </div>
  );
}

function Harness() {
  if (STATE === "composer") return <ComposerKeyHarness />;
  return (
    <div className="flex h-screen bg-background text-foreground">
      <div className="shrink-0 border-e border-border bg-sidebar" style={{ width: MENU }} />
      <div className="min-w-0 flex-1" />
      <RightPanelTabs
        activeSurfaceId="vault"
        availability={resolveRightPanelAvailability({
          projectOpen: true,
          gitRepo: true,
          serverThread: true,
          zeropsPanel: "available",
          crewStatus: "applied",
          matePersona: true,
        })}
        defaultWidth={540}
        liveAgentCount={0}
        maximized={false}
        mode="inline"
        onActivate={noop}
        onAdd={noop}
        onAddTerminal={noop}
        onCloseAllSurfaces={noop}
        onCloseOtherSurfaces={noop}
        onCloseSurface={noop}
        onCloseSurfacesToRight={noop}
        onCopyFilePath={noop}
        pendingSurfaceIds={new Set()}
        surfaces={
          MANY_TABS
            ? TEN_TABS
            : [
                { id: "zerops", kind: "zerops" },
                { id: "vault", kind: "vault" },
              ]
        }
        terminalLabelsById={new Map()}
        widthStorageKey="mate:design-vault:panel-width"
      >
        <RightPanelPage kind="vault" mate="Fen">
          <VaultPanelBody
            actor={ACTOR}
            impactOf={(scope, write) => vaultFixtureImpact(VIEW, scope, write)}
            onRestart={() => new Promise((resolve) => setTimeout(resolve, 1200))}
            onRetry={noop}
            onWrite={async () => {
              await new Promise((resolve) => setTimeout(resolve, 600));
              return FAIL
                ? { ok: false, code: "projectEnvDuplicateKey", message: null }
                : { ok: true };
            }}
            pending={new Map()}
            restarting={new Set()}
            view={VIEW}
            who={
              ACTOR === "mate"
                ? { kind: "mate", name: "Fen", tint: "olive" }
                : { kind: "environment", name: "prod" }
            }
          />
        </RightPanelPage>
      </RightPanelTabs>
    </div>
  );
}

const host = document.getElementById("design");
if (host) {
  createRoot(host).render(
    <StrictMode>
      <Harness />
    </StrictMode>,
  );
}
