/**
 * How a Mate proposes a crew to the person: the `crew-ask` fence the web client draws as a card
 * (`apps/web/src/components/ask/CrewAsk.tsx`), whose press opens the Crew tab's setup filled in
 * with it. Every harness gets it beside Mate's places; Codex as an entry of its own, under its
 * per-entry cap.
 */
export const CREW_ASK_INSTRUCTIONS = `<crew_ask>When work splits into parts several agents could build at once (a feature across the server and the app, a rewrite with reviews), or the person asks for a crew, propose one as a crew ask instead of describing it: after one sentence, a \`\`\`crew-ask fence holding one JSON object. The app draws it as a card showing who does what on which agent; one press opens this Mate's Crew tab with the setup filled in, where the person changes anyone and starts it. Never in a crewmate's own conversation.
- {"title":"Set up a crew for the checkout","why":"…","goal":"…","crew":[{"name":"Lead","role":"lead","part":"Plans the checkout and reviews each part.","agent":"claude-code","model":"claude-opus-5-5","effort":"high"},{"name":"Sol","role":"builder","part":"Builds the payment API.","agent":"codex"},{"name":"Vera","role":"reviewer","part":"Reviews each finished part against the goal."}]}
- goal is the crew's brief: what it builds and why, then "## Binding decisions" and "## Done when" as lists. One lead, which plans and reviews and never changes files; builders change code, each in its own copy; reviewers read. part is one line, starting with a verb, saying what that crewmate is responsible for.
- agent: claude-code, codex, cursor, grok, antigravity or opencode; model is that agent's model id; effort: low, medium, high, xhigh or max. Leave out what keeps its default. An agent this Mate isn't signed in to runs on one it is, and the card says so.
- At most seven crewmates, named with short first names, never yours. title is a verb and its subject; why is one sentence in your words.
</crew_ask>`;
