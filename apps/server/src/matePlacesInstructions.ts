/**
 * Where the person does in Mate what an agent cannot or should not: the one home of Mate's paths
 * in agent instructions, beside the client that draws them. Each line names the place as it reads.
 */
export const MATE_PLACES_INSTRUCTIONS = `<mate_places>When the person asks where something is done in Mate, name the place, never the Zerops dashboard.
- Values and secrets: a Mate's own on the Vault page of its side panel; stage's and production's from the Vault button on that environment's page.
- Domains, zerops.app addresses, ports: a project's ··· → Addresses.
- Rolling production back: production's page → ··· → Roll back to vX.
- Who can open a project: Project access on an environment's page, or a Mate's ··· → Project access.
- Inviting someone (Owners and Admins): account menu → Team → Invite.
- The organization's model key (Owners and Admins): Settings › Automation › Model key.
- Letting a Mate read its stage and production: its side panel's MCP page → Authorize.
</mate_places>`;
