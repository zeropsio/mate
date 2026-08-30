import { definePlugin } from "@oxlint/plugins";

import namespaceNodeImports from "./rules/namespace-node-imports.ts";
import noGlobalProcessRuntime from "./rules/no-global-process-runtime.ts";
import noInfiniteMotion from "./rules/no-infinite-motion.ts";
import noInlineSchemaCompile from "./rules/no-inline-schema-compile.ts";
import noLegacyVocabulary from "./rules/no-legacy-vocabulary.ts";
import noManualEffectRuntimeInTests from "./rules/no-manual-effect-runtime-in-tests.ts";
import noNativeTitleTooltip from "./rules/no-native-title-tooltip.ts";
import noPlatformGlobals from "./rules/no-platform-globals.ts";
import noThemeEscapeHatches from "./rules/no-theme-escape-hatches.ts";

export default definePlugin({
  meta: {
    name: "t3code",
  },
  rules: {
    "namespace-node-imports": namespaceNodeImports,
    "no-global-process-runtime": noGlobalProcessRuntime,
    "no-infinite-motion": noInfiniteMotion,
    "no-inline-schema-compile": noInlineSchemaCompile,
    "no-legacy-vocabulary": noLegacyVocabulary,
    "no-manual-effect-runtime-in-tests": noManualEffectRuntimeInTests,
    "no-native-title-tooltip": noNativeTitleTooltip,
    "no-platform-globals": noPlatformGlobals,
    "no-theme-escape-hatches": noThemeEscapeHatches,
  },
});
