import { assert, describe } from "@effect/vitest";
import { createOxlintRuleBatch } from "../test/utils.ts";

const ioBatch = createOxlintRuleBatch("t3code/no-remote-io-outside-data-layer");
const retiredBatch = createOxlintRuleBatch("t3code/no-retired-mechanism");
const emptyBatch = createOxlintRuleBatch("t3code/no-failure-to-empty");
const storageBatch = createOxlintRuleBatch("t3code/no-remote-data-in-browser-storage");

const io = (filename: string) => ioBatch.createHarness({ filename });
const retired = (filename: string) => retiredBatch.createHarness({ filename });
const empty = (filename: string) => emptyBatch.createHarness({ filename });
const storage = (filename: string) => storageBatch.createHarness({ filename });

describe("sanctioned source boundaries retain their counterexamples", () => {
  const auth = io("apps/web/src/environments/primary/auth.ts");
  auth.valid(
    "error classification can import an aliased error namespace",
    `import { HttpClientError as Errors } from "effect/http"; export const classify = Errors.isHttpClientError;`,
  );
  auth.invalid(
    "an error import cannot hide an aliased HTTP transport",
    `import { HttpClientError as Errors, FetchHttpClient as Transport } from "effect/http"; export const layer = Transport.layer;`,
  );
  auth.valid(
    "the error submodule is also classification only",
    `import * as Errors from "effect/http/HttpClientError"; export const classify = Errors.isHttpClientError;`,
  );

  const tracing = io("apps/web/src/observability/clientTracing.ts");
  tracing.valid(
    "OTLP may disable recursive tracing through the tag",
    `import { HttpClient as HTTP } from "effect/http"; export const layer = Layer.succeed(HTTP.TracerDisabledWhen, () => true);`,
  );
  tracing.invalid(
    "the tracing module cannot read source data with the HTTP client",
    `import { HttpClient as HTTP } from "effect/http"; export const read = HTTP.get("/projects");`,
  );
  tracing.invalid(
    "the tracing module has no general fetch exemption",
    `export const read = () => fetch("/projects");`,
  );

  const creation = io("packages/client-runtime/src/zerops/runEnvironmentCreation.ts");
  creation.valid(
    "creation invokes its operation port, not raw sign-up",
    `interface RunEnvironmentCreationInput { readonly platform: EnvironmentCreationPlatform; } export const run = (input: RunEnvironmentCreationInput) => input.platform.register(target);`,
  );
  creation.invalid(
    "the creation file still guards raw sign-up",
    `interface Input { readonly platform: ZeropsApiClient; } export const run = (input: Input) => input.platform.register(credentials);`,
  );
  creation.invalid(
    "a raw client cannot hide behind a renamed receiver",
    `export const run = (platform: ZeropsApiClient) => platform.register(credentials);`,
  );

  creation.invalid(
    "a typed raw sign-up client stays guarded under an imported alias",
    `import type { ZeropsApiClient as API } from "@t3tools/client-runtime/zerops"; export const run = (remote: API) => remote.register(credentials);`,
  );
  creation.invalid(
    "a constructed raw client stays guarded under a renamed receiver",
    `import { ZeropsApiClient as API } from "@t3tools/client-runtime/zerops"; const remote = new API(options); export const run = () => remote.register(credentials);`,
  );
  const newHook = io("apps/web/src/zerops/newHook.ts");
  newHook.invalid(
    "a raw source subscription alias still belongs in the adapter",
    `import { subscribe as watch } from "@t3tools/client-runtime/rpc"; export const read = () => watch(tag, input);`,
  );
  newHook.invalid(
    "a remote query factory alias cannot build a second source cache",
    `import { createEnvironmentRpcQueryAtomFamily as family } from "@t3tools/client-runtime/state/runtime"; export const read = family({});`,
  );
  newHook.invalid(
    "a component fetch remains guarded",
    `export const read = () => fetch("/api/projects");`,
  );

  const facade = retired("apps/web/src/zerops/useZeropsRegistry.ts");
  const registry = `export function useZeropsRegistry() { const view = useAtomValue(hqNavigationAtom); const structure = view.structure; return structure === null ? { loading: true } : { registry: registryFromHq(structure), loading: false }; }`;
  facade.valid("a registry facade preserves unread and derives the observed projection", registry);
  facade.invalid(
    "a registry facade cannot install a second writer",
    registry.replace("const view", "const cache = Atom.make([]); const view"),
  );
  facade.invalid(
    "a registry facade cannot render unread as settled empty",
    registry.replace("loading: true", "loading: false"),
  );
  // Every consumer occurrence was a false name ban. Each may use the projection facade; each
  // would be rejected if it instead defined a parallel registry cache under the same spelling.
  for (const filename of [
    "components/zerops/ZeropsGitPage.tsx",
    "components/zerops/ZeropsGroupDetail.tsx",
    "components/zerops/ZeropsMateComingPage.tsx",
    "components/zerops/ZeropsProjectsPage.tsx",
    "zerops/useSidebarMateMenus.tsx",
  ]) {
    for (const occurrence of [1, 2, 3]) {
      const consumer = retired(`apps/web/src/${filename}`);
      consumer.valid(
        `${filename} registry occurrence ${occurrence} reads the facade`,
        `import { useZeropsRegistry } from "../zerops/useZeropsRegistry"; export const read = () => useZeropsRegistry();`,
      );
      consumer.invalid(
        `${filename} registry occurrence ${occurrence} cannot define a private cache`,
        `export const useZeropsRegistry = () => Atom.make([]);`,
      );
    }
  }

  const lease = retired("apps/web/src/zerops/matePress.ts");
  lease.invalid(
    "an app-owned press lease stays retired even when it renews and ends",
    `export function pressHold(api) { const renewNow = () => api.holdPress(id); const renewal = setInterval(renewNow, PRESS_RENEW_MS); return () => { clearInterval(renewal); api.endPress(id); }; }`,
    (output) => {
      assert.include(output, "pressHold(");
      assert.include(output, "setInterval(renewNow");
    },
    2,
  );

  const update = retired("apps/web/src/zerops/useZeropsMateUpdate.ts");
  const dismissal = `function settleToIdleAfter(id, generation) { schedule(id, SETTLE_DISPLAY_MS, () => write(id, { state: { phase: "idle" } })); } if (state.phase === "updated") settleToIdleAfter(id, generation);`;
  for (const occurrence of [1, 2, 3]) {
    update.valid(`completed feedback occurrence ${occurrence} can dismiss display`, dismissal);
    update.invalid(
      `completed feedback occurrence ${occurrence} cannot turn overdue into failure`,
      dismissal.replace('phase: "idle"', 'phase: "failed"'),
    );
  }

  update.invalid(
    "pending feedback cannot be dismissed as completed",
    dismissal.replace('state.phase === "updated"', 'state.phase === "updating"'),
  );
  const themeIo = io("apps/web/src/openVsxThemes.ts");
  themeIo.valid(
    "theme search reads the declared public artifact catalog",
    `export async function searchOpenVsxThemes() { const url = new URL(OPEN_VSX_SEARCH_URL); return fetch(url); }`,
  );
  themeIo.invalid(
    "theme source file cannot fetch account facts",
    `export async function searchOpenVsxThemes() { return fetch("/api/projects"); }`,
  );
  const wire = retired("packages/client-runtime/src/rpc/session.ts");
  const replay = `function connect() { const serverConfigState = Ref.make(Option.none<ServerConfigReplayState>()); const events = PubSub.sliding<BufferedServerConfigEvent>(64); return buffered.revision > snapshot.value.revision; }`;
  for (const occurrence of [1, 2, 3]) {
    wire.valid(`config buffer occurrence ${occurrence} orders replay per attempt`, replay);
    wire.invalid(
      `config buffer occurrence ${occurrence} cannot become UI authority`,
      replay.replace("Ref.make(Option.none<ServerConfigReplayState>())", "Atom.make(config)"),
    );
  }

  const bitmap = retired("apps/mobile/src/features/files/workspace-file-image-cache.ts");
  const native = `async function prefetchWithNativeImage(uri) { return Image.prefetch(uri); } export function createWorkspaceFileImageAtomFamily() { return async key => { await prefetch(key.uri); return key.uri; }; } export const image = createWorkspaceFileImageAtomFamily();`;
  for (const occurrence of [1, 2]) {
    bitmap.valid(`native prefetch occurrence ${occurrence} holds only rendering resources`, native);
    bitmap.invalid(
      `native prefetch occurrence ${occurrence} cannot certify file existence`,
      native.replace("return key.uri;", "return { exists: true, uri: key.uri };"),
    );
  }

  const themes = retired("apps/web/src/openVsxThemes.ts");
  themes.valid(
    "theme artifact search is not an account fact cache",
    `export async function search() { const url = new URL(OPEN_VSX_SEARCH_URL); url.searchParams.set("category", "Themes"); return await fetch(url, { signal: requestSignal }); }`,
  );
  themes.invalid(
    "the historical theme fetch token cannot hide source data elsewhere",
    `export async function search(url) { return await fetch(url, { signal: requestSignal }); }`,
  );

  const labels = empty("apps/web/src/components/zerops/ZeropsGroupDetail.tsx");
  labels.valid(
    "optional names leave the attention items intact",
    `import { useMateNames as useNames } from "~/zerops/projectFlows"; const mateNames = useNames(); export const items = projectAttention({ mates, mateNames: mateNames ?? EMPTY_MATE_NAMES });`,
  );
  labels.invalid(
    "the same default cannot erase the attention collection",
    `import { useMateNames as useNames } from "~/zerops/projectFlows"; const mateNames = useNames(); export const items = projectAttention({ mates: mateNames ?? EMPTY_MATE_NAMES });`,
  );
  labels.invalid(
    "an unknown working tree cannot be rendered clean",
    `import { useEnvironmentQuery as useWorkingTree } from "~/state/query"; const tree = useWorkingTree(); export const files = tree.state === "known" ? tree.value.files : [];`,
  );
  const focus = empty("packages/client-runtime/src/zerops/agentLogin.ts");
  focus.valid(
    "failed command focuses no terminal",
    `import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime"; export function agentLoginTerminalToFocus(result: AtomCommandResult<ZeropsAgentLoginStartResult, unknown>) { return result._tag === "Success" ? result.value.terminalId : undefined; }`,
  );
  focus.invalid(
    "the command focus helper cannot empty a source result",
    `import type { AtomCommandResult } from "@t3tools/client-runtime/state/runtime"; export function agentLoginTerminalToFocus(result: AtomCommandResult<ZeropsAgentLoginStartResult, unknown>) { return result._tag === "Success" ? result.value.rows : undefined; }`,
  );
  const lifecycle = empty("packages/client-runtime/src/zerops/model/deriveThreadModel.ts");
  lifecycle.valid(
    "optional lifecycle composition keeps builds unobservable",
    `import type { Known } from "@t3tools/client-runtime/zerops/knowledge"; export function deriveZeropsThreadModel(input: { lifecycle: Known<Lifecycle> }) { const lifecycle: Known<Lifecycle> = input.lifecycle; const envelope = lifecycle?.state === "known" ? lifecycle.value.envelope : undefined; return reduceZeropsOperations(calls, { projectId: envelope?.project.id, builds: input.builds ?? UNOBSERVABLE }); }`,
  );
  lifecycle.invalid(
    "missing lifecycle cannot imply no work",
    `import type { Known } from "@t3tools/client-runtime/zerops/knowledge"; export function deriveZeropsThreadModel(input: { lifecycle: Known<Lifecycle> }) { const lifecycle: Known<Lifecycle> = input.lifecycle; return lifecycle?.state === "known" ? lifecycle.value.operations : []; }`,
  );

  const intents = storage("apps/web/src/zerops/environmentPorts.ts");
  const intentPort = `const intentStorage: AccountEnvironmentPorts["intents"] = { read: () => { const key = accountStorageKey("container-intents.v1"); return window.sessionStorage.getItem(key); }, write: (value) => { const key = accountStorageKey("container-intents.v1"); if (value === null) window.sessionStorage.removeItem(key); else window.sessionStorage.setItem(key, value); } };`;
  for (const method of ["getItem", "removeItem", "setItem"]) {
    intents.valid(`local tab intents may ${method} their declared account key`, intentPort);
    intents.invalid(
      `local tab intents cannot ${method} source verdicts`,
      intentPort.replaceAll('"container-intents.v1"', '"source-status"'),
    );
  }
  intents.invalid(
    "the local intent port cannot persist a fake source answer",
    intentPort.replace(
      "setItem(key, value)",
      'setItem(key, JSON.stringify({ status: "ready", label: source.name }))',
    ),
  );
  intents.invalid(
    "the local intent parameter cannot be replaced by a source answer",
    intentPort.replace(
      "if (value === null)",
      'value = JSON.stringify({ status: "ready" }); if (value === null)',
    ),
  );
  intents.invalid(
    "other code in the intent module cannot store a source label",
    intentPort + `window.sessionStorage.setItem("label", source.name);`,
  );
});
