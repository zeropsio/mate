/**
 * GitHub's "new app" page, reached from this tab: HQ's manifest posted the way that page reads it.
 */
import type { HqGithubManifestView } from "@t3tools/shared/hqGithub";

/**
 * Hands GitHub HQ's manifest the way its "new app" page reads it: a form posted in this tab, its
 * `manifest` field the app's definition. GitHub's page takes over from here.
 */
export function postManifest(
  doc: Document,
  view: Pick<HqGithubManifestView, "postUrl" | "manifest">,
) {
  const form = doc.createElement("form");
  form.method = "POST";
  form.action = view.postUrl;
  form.hidden = true;
  const field = doc.createElement("input");
  field.type = "hidden";
  field.name = "manifest";
  field.value = view.manifest;
  form.append(field);
  doc.body.append(form);
  form.submit();
}
