// Deleting from the interface: the record goes to the trash at once, and a
// toast offers to take it back.

import { restore, trash } from "../data/db.ts";
import type { Id, Table } from "../data/schema.ts";
import { tr } from "../i18n.ts";
import { go } from "../router.ts";
import { toast } from "./toast.ts";

/** Move to the trash, leave the screen it was on if asked, and offer Undo (which returns there). */
export async function moveToTrash(table: Table, id: Id, title: string, o: { leaveTo?: string; backTo?: string } = {}): Promise<void> {
  if (!(await trash(table, id))) return;
  if (o.leaveTo) go(o.leaveTo);
  toast({
    text: tr(`“${title}” is in the trash.`, `« ${title} » est dans la corbeille.`, `„${title}“ ist im Papierkorb.`),
    action: {
      label: tr("Undo", "Annuler", "Rückgängig"),
      run: async () => {
        await restore(table, id);
        if (o.backTo) go(o.backTo);
      },
    },
  });
}
