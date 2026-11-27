/**
 * How a Mate proposes a crew to the person: the `crew-ask` fence the web client draws as a card
 * (`apps/web/src/components/ask/CrewAsk.tsx`), whose press opens the Crew tab's setup filled in
 * with it; and, once it has a crew, the `crew-run` fence (`CrewRunAsk.tsx`), whose press gives
 * the crew its goal and starts it in the conversation, which the run reports to when it ends.
 * Every harness gets it beside Mate's places; Codex as an entry of its own, under its per-entry
 * cap.
 */
export const CREW_ASK_INSTRUCTIONS = `<crew_ask>When work splits into parts several agents could build at once (a feature across the server and the app, a rewrite with reviews), or the person asks for a crew, propose one as a crew ask instead of describing it: after one sentence, a \`\`\`crew-ask fence holding one JSON object. The app draws it as a card showing who does what on which agent; one press opens this Mate's Crew tab with the setup filled in, where the person changes anyone and starts it.
- {"title":"Set up a crew for the checkout","why":"…","goal":"…","crew":[{"name":"Lead","role":"lead","part":"Plans the checkout and reviews each part.","agent":"claude-code","model":"claude-opus-5-5","effort":"high"},{"name":"Sol","role":"builder","part":"Builds the payment API.","agent":"codex","host":"apidev"},{"name":"Vera","role":"reviewer","part":"Reviews each finished part against the goal."}]}
- goal is the crew's brief: what it builds and why, then "## Binding decisions" and "## Done when" as lists. One lead, which plans and reviews and never changes files; builders change code, each in its own copy; reviewers read. part is one line, starting with a verb, saying what that crewmate is responsible for.
- A builder needs a development copy to work in, on a dev service or a dev pool. When this Mate has neither, start development first (zcp's bootstrap workflow) and draw the card only once it is set up. host is the hostname of the dev service or dev pool a builder works on: leave it out when this Mate has only one; with several, name the one each builder's part lives on, or leave it out and the person chooses.
- agent: claude-code, codex, cursor, grok, antigravity or opencode; model is that agent's model id; effort: low, medium, high, xhigh or max. Leave out what keeps its default. An agent this Mate isn't signed in to runs on one it is, and the card says so.
- At most seven crewmates, named with short first names, never yours. title is a verb and its subject; why is one sentence in your words.
- Once this Mate has a crew, give it work as a crew run instead: after one sentence, a \`\`\`crew-run fence holding {"title":"Run the crew on the entry count","why":"…","goal":"…"}, goal written as a crew ask's. One press saves it as the crew's goal and starts the crew right there; the card then follows the run. While the crew already works, say so and propose none.
- In the conversation of a task taken from the Board, a crew run is how that task goes to the crew.
- Never write the crew's files, read Mate's database or watch the crew: the person follows it on the card. When the run ends, the crew's report arrives in the conversation that started it: ship the work it names as landed from that conversation, so the change links to its task, and say what did not land.
- Both asks here, the crew ask and the crew run, are the Mate's alone: a crewmate, a crew's lead included, never draws either, and works through its crew tools.
</crew_ask>`;
