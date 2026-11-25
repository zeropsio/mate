/** What deleting a project takes and leaves (`deleteApplicationWords`), as two short lists. */
import { useAtomValue } from "@effect/atom-react";
import { listedProjectAtom } from "@t3tools/client-runtime/data";

import { Loading } from "~/components/ui/loading";

import {
  productionStaysWords,
  type DeleteApplicationWords,
} from "./ZeropsDeleteApplicationDialog.logic";

/** A production that stays, named by the person's own Zerops list as it reads now. */
function StayingProduction({ projectId }: { readonly projectId: string }) {
  const name = useAtomValue(listedProjectAtom(projectId))?.name;
  return <li>{productionStaysWords(name)}</li>;
}

/** What goes and what stays, as two short lists; what goes reads as unread until HQ said it. */
export function DeleteApplicationLists({ words }: { readonly words: DeleteApplicationWords }) {
  return (
    <div className="space-y-3 text-body" data-zerops-surface="delete-application-lists">
      <div>
        <p className="font-medium">Goes</p>
        {words.goes === undefined ? (
          <Loading label="Reading what HQ holds" shape="words" />
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
          {words.productions.map((projectId) => (
            <StayingProduction key={projectId} projectId={projectId} />
          ))}
          {words.stays.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
