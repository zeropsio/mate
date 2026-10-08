import { createOxlintRuleHarness } from "../test/utils.ts";
const chrome = createOxlintRuleHarness("t3code/no-legacy-notice-policy", {
  filename: "apps/web/src/zerops/chatChrome.ts",
});
const chat = createOxlintRuleHarness("t3code/no-legacy-notice-policy", {
  filename: "apps/web/src/components/OtherChat.tsx",
});
chrome.invalid(
  "another binding cannot restore the removed chip policy",
  'import { zeropsAgentSignInRequired as needs } from "@t3tools/client-runtime/zerops/agentLogin"; export const state = needs(feed);',
);
chrome.invalid(
  "a local alias cannot restore the removed chip policy",
  'import { zeropsAgentSignInRequired as needs } from "@t3tools/client-runtime/zerops/agentLogin"; const alias = needs; export const state = alias(feed);',
);
chat.invalid(
  "another surface cannot relocate the removed chip policy",
  'import { zeropsAgentSignInRequired as needs } from "@t3tools/client-runtime/zerops/agentLogin"; export const state = needs(feed);',
);
const admissionChat = createOxlintRuleHarness("t3code/no-legacy-notice-policy", {
  filename: "apps/web/src/components/ChatView.tsx",
});
admissionChat.invalid(
  "admission policy cannot relocate beside the preserved arrival query",
  'import { zeropsAgentSignInRequired as needs } from "@t3tools/client-runtime/zerops/agentLogin"; export const restoredAdmission = needs(feed);',
);
const arrival = createOxlintRuleHarness("t3code/no-legacy-notice-policy", {
  filename: "apps/web/src/components/zerops/ZeropsMateEmptyState.tsx",
});
arrival.valid(
  "the arrival family's existing any-agent query is outside this slice",
  'import { zeropsAgentSignInRequired } from "@t3tools/client-runtime/zerops/agentLogin"; export const signInRequired = zeropsAgentSignInRequired(feed);',
);
chat.invalid(
  "another surface cannot relocate spent-login policy",
  'import { spentLoginStatusStale as stale } from "@t3tools/client-runtime/zerops/logins"; export const state = stale(status, feed, providers);',
);
chat.invalid(
  "namespace and destructuring cannot restore spent-login policy",
  'import * as logins from "@t3tools/client-runtime/zerops/logins"; const { spentLoginStatusStale: stale } = logins; export const state = stale(status, feed, providers);',
);
chat.valid(
  "surfaces consume admission",
  'import { agentAdmission } from "@t3tools/client-runtime/data"; export const state = agentAdmission(input);',
);

admissionChat.valid(
  "the chat's existing arrival query stays with its arrival owner",
  'import { zeropsAgentSignInRequired } from "@t3tools/client-runtime/zerops/agentLogin"; export const state = mateArrivalHoldsComposer({signInRequired: zeropsAgentSignInRequired(feed)});',
);
const crew = createOxlintRuleHarness("t3code/no-legacy-notice-policy", {
  filename: "apps/web/src/components/zerops/crew/CrewPanel.tsx",
});
crew.valid(
  "crew keeps its existing arrival condition",
  'import { zeropsAgentSignInRequired } from "@t3tools/client-runtime/zerops/agentLogin"; export function CrewPanel() { if (zeropsAgentSignInRequired(feed)) { return <div><ZeropsMateEmptyState /></div>; } }',
);
crew.invalid(
  "crew cannot acquire another admission policy",
  'import { zeropsAgentSignInRequired } from "@t3tools/client-runtime/zerops/agentLogin"; export const attention = zeropsAgentSignInRequired(feed);',
);
