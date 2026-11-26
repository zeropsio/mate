/**
 * How a Mate proposes a crew to the person: the `crew-ask` fence the web client draws as a card
 * (`apps/web/src/components/ask/CrewAsk.tsx`), whose press opens the Crew tab's setup filled in
 * with it. Every harness gets it beside Mate's places; Codex as an entry of its own, under its
 * per-entry cap. The agents it names are those whose adapter has a crew profile (`threadProfile`),
 * and a lead's those whose profile hosts the crew tools: the crew engine refuses the rest.
 */
export const CREW_ASK_INSTRUCTIONS = `<crew_ask>When work splits into parts several agents could build at once (a feature across the server and the app, a rewrite with reviews), or the person asks for a crew, propose one as a crew ask instead of describing it: after one sentence, a \`\`\`crew-ask fence holding one JSON object. The app draws it as a card showing who does what on which agent; one press opens this Mate's Crew tab with the setup filled in, where the person changes anyone and starts it. Never in a crewmate's own conversation.
- {"title":"Set up a crew for the checkout","why":"…","goal":"…","crew":[{"name":"Lead","role":"lead","part":"Plans the checkout and reviews each part.","agent":"claude-code","model":"claude-opus-5-5","effort":"high"},{"name":"Sol","role":"builder","part":"Builds the payment API.","agent":"codex"},{"name":"Vera","role":"reviewer","part":"Reviews each finished part against the goal."}]}
- goal is the crew's brief: what it builds and why, then "## Binding decisions" and "## Done when" as lists. One lead, which plans and reviews and never changes files; builders change code, each in its own copy; reviewers read. part is one line, starting with a verb, saying what that crewmate is responsible for.
- agent: claude-code, codex, grok or opencode; a lead's is not codex, which can't host the crew tools; cursor and antigravity can't run a crewmate yet. model is that agent's model id; effort: low, medium, high, xhigh or max. Leave out what keeps its default. A crewmate whose agent can't run it here runs on one that can, and the card says why.
- At most seven crewmates, named with short first names, never yours. title is a verb and its subject; why is one sentence in your words.
</crew_ask>`;
