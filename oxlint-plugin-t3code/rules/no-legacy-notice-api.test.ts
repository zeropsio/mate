import { createOxlintRuleHarness } from "../test/utils.ts";
const recovery = createOxlintRuleHarness("t3code/no-legacy-notice-api", {
  filename: "apps/web/src/zerops/useMateRecoveryAction.ts",
});
recovery.invalid(
  "recovery cannot lose its request in a transient toast",
  'import { toastManager } from "~/components/ui/toast"; toastManager.add({type:"error"});',
);
recovery.invalid(
  "recovery cannot restore its toast through an imported alias",
  'import { toastManager as notices } from "~/components/ui/toast"; notices.add({type:"error"});',
);
recovery.invalid(
  "recovery cannot restore its toast through destructuring",
  'import { toastManager } from "~/components/ui/toast"; const {add: show} = toastManager; show({});',
);
recovery.valid(
  "recovery keeps unrelated feature APIs",
  "const writer = {add: () => {}}; writer.add();",
);
recovery.valid(
  "recovery consumes the retained operation",
  'import { recoveryOutcome } from "@t3tools/client-runtime/data"; export const read = recoveryOutcome;',
);
const shell = createOxlintRuleHarness("t3code/no-legacy-notice-api", {
  filename: "apps/web/src/zerops/recoveryOutcomes.tsx",
});
shell.invalid(
  "the recovery presentation owner cannot relocate the old toast",
  'import * as toast from "~/components/ui/toast"; toast.toastManager.add({});',
);
const other = createOxlintRuleHarness("t3code/no-legacy-notice-api", {
  filename: "apps/web/src/zerops/other.ts",
});
other.valid(
  "unmigrated notice families retain their existing API",
  'import { toastManager } from "~/components/ui/toast"; toastManager.add({});',
);
