/**
 * Where the person does in Mate what an agent cannot or should not: the one home of Mate's paths
 * in agent instructions, beside the client that draws them. Each control's label stands between
 * asterisks exactly as the client draws it, with no variable part.
 */
export const MATE_PLACES_INSTRUCTIONS = `<mate_places>When the person asks where something is done in Mate, name the place, never the Zerops dashboard. Controls are starred as they read.
- Values and secrets: a Mate's own on the *Vault* page of its side panel; stage's and production's from the *Vault* button on that environment's page.
- Domains, zerops.app addresses, ports: a project's ··· → *Addresses*.
- Putting the app live the first time: the project's card → *Put it live*.
- Merging a change: its page's *Merge*; the line at the page's top says why Merge is held.
- Releasing merged work: *Review release* → *Release*.
- Rolling production back: production's page → ··· → *Roll back to* vX.
- Keeping the code on GitHub: a project's ··· → *Connect to GitHub…*; the card an agent's ask draws says *Keep the code on GitHub*.
- Who can open a project: *Project access* on an environment's page, or a Mate's ··· → *Project access…*.
- Inviting someone (Owners and Admins): account menu → *Team* → *Invite*.
- The organization's model key (Owners and Admins): Settings › *Automation* › *Model key*.
- Letting a Mate read its stage and production: its side panel's *Tools* page → *Authorize*.
- Connecting a tool's MCP server: the card zerops_propose_mcp draws, where they type any key; never in chat.
- A place this list does not hold: say so and ask for a screenshot of the screen they are on (on a model without image input, what it shows); never read Mate's code or its bundle to find a label.
</mate_places>`;
