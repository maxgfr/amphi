// The passage a citation points to, in a sheet over the screen that cited it.

import { useEffect } from "react";
import { get } from "../data/db.ts";
import { useLive } from "../data/hooks.ts";
import { useLang } from "../i18n.ts";
import { href } from "../router.ts";
import { closeCitation, passageText, useShownCitation } from "./cite.ts";
import { Icon } from "./icons.tsx";
import { Sheet } from "./kit.tsx";
import { Markdown } from "./markdown.tsx";

export function CitationSheet() {
  const { t } = useLang();
  const shown = useShownCitation();
  const source = useLive(async () => (shown ? ((await get("sources", shown.sourceId)) ?? null) : null), ["sources"], [shown?.sourceId]);
  // Leaving the screen closes it.
  useEffect(() => {
    window.addEventListener("hashchange", closeCitation);
    return () => window.removeEventListener("hashchange", closeCitation);
  }, []);
  if (!shown) return null;
  const ready = source && source.id === shown.sourceId ? source : null;
  const text = ready ? passageText(ready, shown.key, shown.label, shown.t) : "";
  return (
    <Sheet open onClose={closeCitation} title={ready?.title ?? shown.label} wide>
      <div className="stack">
        <p className="cite-where">
          <span className="cite">{shown.label}</span>
        </p>
        {source === null ? (
          <p className="meta">{t("This source no longer exists.", "Cette source n'existe plus.", "Diese Quelle existiert nicht mehr.")}</p>
        ) : ready ? (
          text ? (
            <div className="cite-passage">{ready.kind === "text" || ready.kind === "web" ? <Markdown text={text} /> : <p>{text}</p>}</div>
          ) : (
            <p className="meta">{t("This source has no text yet.", "Cette source n'a pas encore de texte.", "Diese Quelle hat noch keinen Text.")}</p>
          )
        ) : (
          <div className="cite-passage" aria-busy="true" />
        )}
        {ready ? (
          <div className="row end">
            <a className="button secondary" href={href.source(ready.id, { page: shown.page, t: shown.t })}>
              <Icon name="file" size={18} /> {t("Open the source", "Ouvrir la source", "Quelle öffnen")}
            </a>
          </div>
        ) : null}
      </div>
    </Sheet>
  );
}
