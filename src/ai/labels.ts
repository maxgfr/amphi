// Models sometimes group their citations, "[S1 §1, S2 p.3]", although they
// are asked for one label per bracket: split those into "[S1 §1] [S2 p.3]"
// before anything reads the labels.

const ONE = /^S\d+(?: (?:p\.\d+|§\d+|\d+:\d{2}(?::\d{2})?))?$/;
const GROUP = /\[\s*(S\d+[^[\]]*?)\s*\]/g;

export function expandCitations(text: string): string {
  return text.replace(GROUP, (all, inner: string) => {
    const parts = inner.split(/\s*[,;]\s*/);
    return parts.length > 1 && parts.every((p) => ONE.test(p)) ? parts.map((p) => `[${p}]`).join(" ") : all;
  });
}
