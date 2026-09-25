import { createShadcnGuardRule, UI_SOURCE_MARKER, WEB_SOURCE_MARKER } from "../shadcnGuard.ts";

/**
 * `components/ui` exports own their look: app code picks a variant or size instead of restyling
 * one with `className`. Upstream's `shadcn/no-restyle` with the options upstream configures,
 * behind the design-system exception ledger (`exceptions/no-restyle.json`).
 */

/**
 * Layout classes (width, flex, margin, position) stay allowed because placement belongs to the
 * parent. Contracts widen that per component where the className is the component's API.
 */
export const NO_RESTYLE_OPTIONS = {
  allow: ["layout"],
  contracts: [
    {
      // CollapsibleTrigger is a bare button with no styled counterpart (a disclosure row is not
      // a Button), so its className is the API. Every other trigger has one: style them with
      // render={<Button …/>}.
      pattern: "^CollapsibleTrigger$",
      allow: ["layout", "color", "typography", "spacing", "shape", "effects", "motion"],
    },
  ],
};

export default createShadcnGuardRule({
  ruleName: "no-restyle",
  innerRuleName: "no-restyle",
  ledgerDirectoryEnv: "T3CODE_NO_RESTYLE_LEDGER_DIRECTORY",
  options: NO_RESTYLE_OPTIONS,
  inScope: (filename) =>
    filename.includes(WEB_SOURCE_MARKER) && !filename.includes(UI_SOURCE_MARKER),
  description:
    "components/ui exports own their look: pick a variant or size instead of restyling with className, with fingerprinted exceptions for existing call sites.",
});
