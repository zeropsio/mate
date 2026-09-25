import { createShadcnGuardRule, UI_SOURCE_MARKER, WEB_SOURCE_MARKER } from "../shadcnGuard.ts";

/**
 * A className built at runtime on a components/ui export is one no-restyle cannot read.
 * Upstream's `shadcn/require-static-classes` behind the design-system exception ledger.
 */
export default createShadcnGuardRule({
  ruleName: "require-static-classes",
  innerRuleName: "require-static-classes",
  ledgerDirectoryEnv: "T3CODE_REQUIRE_STATIC_CLASSES_LEDGER_DIRECTORY",
  options: {},
  inScope: (filename) =>
    filename.includes(WEB_SOURCE_MARKER) && !filename.includes(UI_SOURCE_MARKER),
  description:
    "classNames on components/ui exports are static strings the restyle guard can read, with fingerprinted exceptions for existing call sites.",
});
