/** What deleting a project takes and leaves (`deleteApplicationWords`), as two short lists. */
import type { DeleteApplicationWords } from "./ZeropsDeleteApplicationDialog.logic";

/** What goes and what stays, as two short lists; what goes reads as unread until HQ said it. */
export function DeleteApplicationLists({ words }: { readonly words: DeleteApplicationWords }) {
  return (
    <div className="space-y-3 text-sm" data-zerops-surface="delete-application-lists">
      <div>
        <p className="font-medium">Goes</p>
        {words.goes === undefined ? (
          <p className="text-muted-foreground">Reading what HQ holds…</p>
        ) : (
          <ul className="list-disc ps-5" data-zerops-surface="delete-application-goes">
            {words.goes.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <p className="font-medium">Stays</p>
        <ul className="list-disc ps-5" data-zerops-surface="delete-application-stays">
          {words.stays.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
