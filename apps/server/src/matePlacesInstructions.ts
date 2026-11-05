/**
 * Where the person does in Mate what an agent cannot or should not: the one home of Mate's paths
 * in agent instructions, beside the client that draws them. Each line names the place as it reads.
 * The picture ask is the card the client draws from a `picture-ask` fence (`PictureAsk.tsx`).
 */
export const MATE_PLACES_INSTRUCTIONS = `<mate_places>When the person asks where something is done in Mate, name the place, never the Zerops dashboard.
- Values and secrets: a Mate's own on the Vault page of its side panel; stage's and production's from the Vault button on that environment's page.
- Domains, zerops.app addresses, ports: a project's ··· → Addresses.
- Rolling production back: production's page → ··· → Roll back to vX.
- Who can open a project: Project access on an environment's page, or a Mate's ··· → Project access.
- Inviting someone (Owners and Admins): account menu → Team → Invite.
- The organization's model key (Owners and Admins): Settings › Automation › Model key.
- Letting a Mate read its stage and production: its side panel's MCP page → Authorize.
- Connecting a tool's MCP server: the card zerops_propose_mcp draws, where they type any key; never in chat.
</mate_places>
<picture_ask>When the work needs a picture only a person can make or choose (an empty hero or feature image, product photos to cut out, a launch post), set it up as a picture ask instead of describing it: after one sentence, a \`\`\`picture-ask fence holding one JSON object. The app draws it as a card; with Adobe Express on, one press opens it there already set up, and anyone can upload their own picture. The answer arrives as the person's next message: the picture, its saved full-size file, what it answers.
- Make one: {"do":"generate","title":"Make the homepage hero","why":"…","for":"public/images/hero.jpg","prompt":"…","shape":"widescreen","styleLike":"/abs/path/about.jpg"}. shape: square, portrait, landscape or widescreen (at most 2688×1536). Write the prompt from the page's words and the brand's colours, no text in the picture; styleLike is a picture it should match.
- Edit some, one press each: {"do":"edit","title":"Cut out the product photos","why":"…","for":"public/products/","tool":"remove-background","pictures":["/abs/a.jpg"]}. tool: remove-background, gen-fill, remove-object, insert-object, crop-image, resize-image, auto-enhance or erase.
- Design: {"do":"design","title":"Design the launch post","why":"…","templates":"coffee shop launch","size":"instagram-post","startWith":"/abs/shot.png","words":"…"}. size: instagram-post, instagram-story, instagram-portrait, facebook-post, linkedin-post, youtube-thumbnail, presentation, flyer or poster; startWith is a picture placed on it, such as a screenshot you saved; words are for the person to paste.
- Pictures are PNG or JPEG files by absolute path. title is a verb and its subject; why is one sentence in your words.
- When it comes back, put it in place yourself: copy it to its target, make the smaller sizes, wire it in, show the result. Resize, crop, compress and convert yourself; never ask a person for those.
</picture_ask>`;
