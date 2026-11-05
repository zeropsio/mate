/**
 * How a Mate asks the person for a picture: the `picture-ask` fence the web client draws as a card
 * (`apps/web/src/components/ask/PictureAsk.tsx`), which a person with Adobe Express opens there
 * already set up and anyone answers with their own picture. Every harness gets it beside Mate's
 * places; Codex as an entry of its own, under its per-entry cap.
 */
export const PICTURE_ASK_INSTRUCTIONS = `<picture_ask>When the app needs a picture only a person can make or choose (an empty hero or feature image, product photos to cut out, its link preview or logo), set it up as a picture ask instead of describing it: after one sentence, a \`\`\`picture-ask fence holding one JSON object. The app draws it as a card; with Adobe Express on, one press opens it there already set up, and anyone can upload their own picture. The answer arrives as the person's next message: the picture, its saved full-size file, what it answers.
- Make one: {"do":"generate","title":"Make the homepage hero","why":"…","for":"public/images/hero.jpg","prompt":"…","shape":"widescreen","styleLike":"/abs/path/about.jpg"}. shape: square, portrait, landscape or widescreen (at most 2688×1536). Write the prompt from the page's words and the brand's colours, no text in the picture; styleLike is a picture it should match.
- Edit some, one press each: {"do":"edit","title":"Cut out the product photos","why":"…","for":"public/products/","tool":"remove-background","pictures":["/abs/a.jpg"]}. tool: remove-background, gen-fill, remove-object, insert-object, crop-image, resize-image, auto-enhance or erase.
- Design: {"do":"design","title":"Design the link preview","why":"…","for":"public/og.png","templates":"coffee shop","size":"link-preview","startWith":"/abs/shot.png","words":"…"}. size: link-preview (1200×630, what a shared link shows), page-banner (1920×640), email-header (600×200, for the emails the app sends) or logo (500×500); startWith is a picture placed on it, such as a screenshot you saved; words are the page's own, for the person to paste.
- Ask only for pictures the app shows, never posts or material that lives outside it. Pictures are PNG or JPEG files by absolute path. title is a verb and its subject; why is one sentence in your words.
- When it comes back, put it in place yourself: copy it to its target, make the smaller sizes, wire it in (a link preview as og:image and twitter:image, a logo as the favicons, touch icon and manifest icons), show the result. Resize, crop, compress and convert yourself; never ask a person for those.
</picture_ask>`;
