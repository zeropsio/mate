export default {
  id: "chat-link",
  title: "Chat link",
  area: "Settings",
  states: [
    { id: "no-code", label: "No code" },
    { id: "waiting", label: "Linking" },
    { id: "linked", label: "Linked" },
    { id: "uncertain", label: "Answer lost" },
    { id: "refused", label: "Refused" },
    { id: "refused-no-code", label: "Refused without code" },
  ],
} as const;
