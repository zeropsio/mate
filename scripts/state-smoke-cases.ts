// Shared selection for the blocking state smoke and the local gate.
export const stateOnlySmoke = {
  "apps/web/test/scenarios/areas/c-mate/chat.scenario.ts": [
    "cold direct conversation URL opens the named Mate and its history",
    "reload restores history",
    "sending a message puts it in the durable visible conversation",
    "approve an agent command and see it resolve",
  ],
  "apps/web/test/scenarios/areas/c-mate/engine-secret.scenario.ts": [
    "a secret the person gives never reaches the Mate's records or its agent",
  ],
  "apps/web/test/scenarios/areas/c-mate/engine-page.scenario.ts": [
    "a published page that navigates itself by script sends nothing and is never shown",
  ],
} as const;
