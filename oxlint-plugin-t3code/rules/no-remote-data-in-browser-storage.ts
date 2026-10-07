import { defineRule, type ESTree } from "@oxlint/plugins";
import * as Option from "effect/Option";

import {
  formatFindingMessage,
  loadExceptionLedger,
  normalizeFingerprint,
  shouldReportLedgered,
} from "../exceptions.ts";
import { compactSyntax } from "./boundaries.ts";
import { getPropertyName, resolveVariable, unwrapExpression } from "../utils.ts";

/**
 * Data a source answered never lands in browser storage: it lives in memory, in the store, and a
 * reload reads it again. Browser storage holds what the person chose and typed and how they sign
 * in. Every use of `localStorage`, `sessionStorage`, IndexedDB, a `storage` event, the app's own
 * storage helpers, the mobile key-value stores and zustand's `persist` (local storage by default)
 * is reported outside the modules allowed below.
 *
 * Out of scope for now: the mobile app's SQLite offline cache (`persistence/mobile-database.ts`,
 * `connection/environment-cache-store.ts`, the dynamic `import("expo-sqlite")`), T3's own cache of
 * Mate conversations; the data-layer rewrite decides its fate separately.
 */
const RULE_NAME = "no-remote-data-in-browser-storage";
const LEDGER_DIRECTORY_ENV = "T3CODE_BROWSER_STORAGE_LEDGER_DIRECTORY";
const SCOPE_MARKERS = [
  "/apps/web/src/",
  "/apps/mobile/src/",
  "/packages/client-runtime/src/",
] as const;
const TEST_FILE_PATTERN =
  /(?:^|\/)(?:__tests__\/|__fixtures__\/|testing\/|[^/]+\.(?:test|spec|bench)\.[cm]?[jt]sx?$)/u;

/**
 * The modules that may touch browser storage, each for what the person chose or typed, or for how
 * they sign in, never for what a source answered. A new module joins by review, by kind.
 */
const ALLOWED_MODULES: ReadonlySet<string> = new Set([
  // The storage helpers themselves.
  "apps/web/src/hooks/useLocalStorage.ts",
  "apps/web/src/zerops/accountLifetime.ts",
  // Sign-in: sessions, hand-over nonces, the sign-in return path, kept tokens, DPoP keys.
  "apps/web/src/zerops/storage.ts",
  "apps/web/src/zerops/ZeropsSessionProvider.tsx",
  "apps/web/src/zerops/handover.ts",
  "apps/web/src/zerops/navigationStorage.ts",
  "apps/web/src/zerops/reauth.ts",
  "apps/web/src/zerops/keptSessions.ts",
  // The first frame follows whether this browser holds a session, never what a source said.
  "apps/web/src/zerops/bootFrame.ts",
  "apps/web/src/cloud/dpop.ts",
  "apps/mobile/src/features/zerops/storage.ts",
  "apps/mobile/src/features/cloud/dpop.ts",
  "apps/mobile/src/features/cloud/managedRelayTokenStore.ts",
  "apps/mobile/src/persistence/mobile-secure-storage.ts",
  // Drafts: unsent composer text and stashed prompts.
  "apps/web/src/zerops/draftStorage.ts",
  "apps/web/src/composerDraftStore.ts",
  "apps/web/src/promptStashStore.ts",
  // Preferences: layout, theme, order, filters, dismissed hints, settings.
  "apps/web/src/clientPersistenceStorage.ts",
  "apps/web/src/components/AppSidebarLayout.tsx",
  "apps/web/src/components/ChatView.tsx",
  "apps/web/src/components/ServiceBrowserPanel.tsx",
  "apps/web/src/components/Sidebar.tsx",
  "apps/web/src/components/ThreadTerminalDrawer.tsx",
  "apps/web/src/components/files/FilePreviewPanel.tsx",
  "apps/web/src/components/settings/SettingsPanels.logic.ts",
  "apps/web/src/components/settings/SettingsPanels.tsx",
  "apps/web/src/components/ui/sidebar.tsx",
  "apps/web/src/components/usage/usagePagePreferences.ts",
  "apps/web/src/design/sidebarHarness.tsx",
  "apps/web/src/diffPanelStore.ts",
  "apps/web/src/editorPreferences.ts",
  "apps/web/src/hooks/useResizableWidth.ts",
  "apps/web/src/hooks/useTheme.ts",
  "apps/web/src/providerUpdateDismissal.ts",
  "apps/web/src/remoteOpen.ts",
  "apps/web/src/rightPanelStore.ts",
  "apps/web/src/terminalUiStateStore.ts",
  "apps/web/src/themePalette.ts",
  "apps/web/src/uiStateStore.ts",
  "apps/web/src/zerops/collapsedProjects.ts",
  "apps/web/src/zerops/mateScope.ts",
  "apps/web/src/zerops/mutedMates.ts",
  "apps/web/src/zerops/projectOrderPreference.ts",
  // Own-action records: what this browser itself did or owes, never a copy of a source's answer.
  "apps/web/src/lib/backgroundActivityReporter.ts",
  "apps/web/src/zerops/creationMemory.ts",
  "apps/web/src/zerops/diagnostics.ts",
  "apps/web/src/zerops/throwawayDebt.ts",
]);

const ledger = loadExceptionLedger(RULE_NAME, globalThis.process.env[LEDGER_DIRECTORY_ENV]);

const coveredPath = (filename: string): string | undefined => {
  const normalized = `/${filename.replaceAll("\\", "/")}`;
  for (const marker of SCOPE_MARKERS) {
    const index = normalized.lastIndexOf(marker);
    if (index === -1) continue;
    const path = normalized.slice(index + 1);
    return TEST_FILE_PATTERN.test(path) || ALLOWED_MODULES.has(path) ? undefined : path;
  }
  return undefined;
};

/** The browser's storage globals. */
const STORAGE_GLOBALS: ReadonlySet<string> = new Set([
  "localStorage",
  "sessionStorage",
  "indexedDB",
]);
/** The app's own storage helpers, each a front for one of those globals. */
const STORAGE_HELPERS: ReadonlySet<string> = new Set([
  "accountLocalStorage",
  "accountDraftStorage",
  "createDraftStorage",
  "browserZeropsStorage",
  "getLocalStorageItem",
  "setLocalStorageItem",
  "removeLocalStorageItem",
  "useLocalStorage",
]);
/** The mobile app's persistent key-value stores. */
const STORAGE_LIBRARIES: ReadonlySet<string> = new Set([
  "expo-secure-store",
  "@react-native-async-storage/async-storage",
  "react-native-mmkv",
]);
const GLOBAL_OBJECTS: ReadonlySet<string> = new Set(["globalThis", "window", "self"]);

const STORED_IN_MEMORY =
  "Source data stays out of browser storage: hold it in the store; storage keeps preferences, drafts and sign-in.";

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Browser storage holds preferences, drafts and sign-in only; data a source answered is held in memory.",
    },
  },
  create(context) {
    const path = coveredPath(context.filename);
    if (path === undefined) return {};

    // Existing tab intent port: only account-keyed opaque input, never a source result.
    // Keep this scoped to the typed record until its codec moves; the rest of this file is guarded.
    const ownIntentUse = (reference: ESTree.Node): boolean => {
      if (
        path !== "apps/web/src/zerops/environmentPorts.ts" &&
        path !== "apps/web/src/zerops/containerIntentStorage.ts"
      )
        return false;
      let declaration: ESTree.Node | null = reference;
      while (declaration !== null && declaration.type !== "VariableDeclarator")
        declaration = declaration.parent;
      // A nested key declaration belongs to the same object, so find the enclosing intent binding.
      while (declaration !== null) {
        if (
          declaration.type === "VariableDeclarator" &&
          declaration.id.type === "Identifier" &&
          ["intentStorage", "containerIntentStorage"].includes(declaration.id.name)
        )
          break;
        declaration = declaration.parent;
      }
      if (declaration?.type !== "VariableDeclarator") return false;
      const contract = compactSyntax(context, declaration.id);
      if (!contract.includes('AccountEnvironmentPorts["intents"]')) return false;
      const member = reference.parent;
      const call = member?.parent;
      if (
        member?.type !== "MemberExpression" ||
        call?.type !== "CallExpression" ||
        call.callee !== member
      )
        return false;
      const method = getPropertyName(member.property).pipe(Option.getOrUndefined);
      const key = call.arguments[0];
      if (key?.type !== "Identifier" || key.name !== "key") return false;
      const keyBinding = resolveVariable(context, key)?.defs[0]?.node;
      if (
        keyBinding?.type !== "VariableDeclarator" ||
        keyBinding.init === null ||
        compactSyntax(context, keyBinding.init) !== 'accountStorageKey("container-intents.v1")'
      )
        return false;
      if (method === "getItem" || method === "removeItem") return call.arguments.length === 1;
      if (method !== "setItem" || call.arguments.length !== 2) return false;
      const value = call.arguments[1];
      if (value?.type !== "Identifier" || value.name !== "value") return false;
      const binding = resolveVariable(context, value);
      return (
        binding?.defs[0]?.type === "Parameter" &&
        binding.references.every((reference) => !reference.isWrite())
      );
    };

    const textOf = (node: ESTree.Node): string => context.sourceCode.getText(node);

    const report = (node: ESTree.Node, fingerprintText: string) => {
      const kind = node.type;
      const fingerprint = normalizeFingerprint(fingerprintText);
      const ledgered = ledger.has({ path, kind, fingerprint });
      if (ledgered && !shouldReportLedgered()) return;
      context.report({
        node,
        message: formatFindingMessage({
          ruleName: RULE_NAME,
          summary: STORED_IN_MEMORY,
          kind,
          fingerprint,
          ledgered,
        }),
      });
    };

    /**
     * Reports a storage reference at the use it is put to: `storage.getItem(KEY)` or
     * `helper(KEY, …)` as that call, keyed by its first argument, or the bare reference where it is
     * passed on.
     */
    const reportUse = (reference: ESTree.Node) => {
      if (ownIntentUse(reference)) return;
      const parent = reference.parent;
      if (parent?.type === "CallExpression" && parent.callee === reference) {
        const key = parent.arguments[0];
        return report(parent, `${textOf(reference)}(${key === undefined ? "" : textOf(key)})`);
      }
      if (
        parent?.type === "MemberExpression" &&
        parent.object === reference &&
        parent.parent?.type === "CallExpression" &&
        parent.parent.callee === parent
      ) {
        const call = parent.parent;
        const key = call.arguments[0];
        return report(call, `${textOf(parent)}(${key === undefined ? "" : textOf(key)})`);
      }
      report(reference, textOf(reference));
    };

    return {
      CallExpression(node) {
        const callee = Option.getOrUndefined(unwrapExpression(node.callee));
        const method =
          callee?.type === "MemberExpression" && !callee.computed
            ? Option.getOrUndefined(getPropertyName(callee.property))
            : callee?.type === "Identifier"
              ? callee.name
              : undefined;
        const [event] = node.arguments;
        if (
          method === "addEventListener" &&
          event?.type === "Literal" &&
          event.value === "storage"
        ) {
          report(node, `${textOf(node.callee)}("storage")`);
        }
      },
      ImportDeclaration(node) {
        if (node.importKind === "type") return;
        const source = String(node.source.value);
        if (STORAGE_LIBRARIES.has(source)) return report(node, source);
        if (source !== "zustand/middleware") return;
        for (const specifier of node.specifiers) {
          if (
            specifier.type === "ImportSpecifier" &&
            specifier.importKind !== "type" &&
            specifier.imported.type === "Identifier" &&
            specifier.imported.name === "persist"
          ) {
            report(specifier, `${source} persist`);
          }
        }
      },
      Identifier(node) {
        const global = STORAGE_GLOBALS.has(node.name);
        if (!global && !STORAGE_HELPERS.has(node.name)) return;
        const parent = node.parent;
        if (parent?.type === "MemberExpression" && parent.property === node && !parent.computed) {
          return;
        }
        if (parent?.type.startsWith("Import") || parent?.type.startsWith("Export")) return;
        const definitions = resolveVariable(context, node)?.defs ?? [];
        const used = global
          ? definitions.length === 0
          : definitions.length === 1 && definitions[0]?.type === "ImportBinding";
        if (used) reportUse(node);
      },
      MemberExpression(node) {
        if (node.computed) return;
        const name = Option.getOrUndefined(getPropertyName(node.property));
        if (name === undefined || !STORAGE_GLOBALS.has(name)) return;
        const object = Option.getOrUndefined(unwrapExpression(node.object));
        if (object?.type !== "Identifier" || !GLOBAL_OBJECTS.has(object.name)) return;
        reportUse(node);
      },
    };
  },
});
