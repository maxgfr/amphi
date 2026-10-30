// Markdown from the model or the student, rendered safely: marked turns it
// into HTML, DOMPurify keeps only harmless markup (through its own Trusted
// Types policy), and citation labels such as [S1 p.3] become buttons that
// open the passage.

import DOMPurify from "dompurify";
import { Marked } from "marked";
import { useEffect, useMemo, useRef } from "react";
import { expandCitations } from "../ai/labels.ts";

const marked = new Marked({ gfm: true, breaks: false, async: false });

const LABEL = /\[(S\d+(?: (?:p\.\d+|§\d+|\d+:\d{2}(?::\d{2})?))?)\]/g;

const escapeAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const CONFIG = {
  ALLOWED_TAGS: ["p", "br", "strong", "em", "del", "code", "pre", "blockquote", "ul", "ol", "li", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "a", "table", "thead", "tbody", "tr", "th", "td", "button", "sup", "sub"],
  ALLOWED_ATTR: ["href", "title", "class", "data-cite", "type", "start", "align", "target", "rel"],
  ALLOW_DATA_ATTR: false,
};

function rawHtml(md: string, cite: boolean): string {
  const html = marked.parse(cite ? expandCitations(md) : md) as string;
  return cite ? html.replace(LABEL, (_, label: string) => `<button type="button" class="cite" data-cite="${escapeAttr(label)}">${label}</button>`) : html;
}

/** Markdown to sanitized HTML; citation labels become `<button data-cite>`. */
export function toSafeHtml(md: string, cite: boolean): string {
  return DOMPurify.sanitize(rawHtml(md, cite), { ...CONFIG, RETURN_TRUSTED_TYPE: false }) as string;
}

// Links leave in a new tab, without the page's address.
DOMPurify.addHook("afterSanitizeAttributes", (node) => {
  if (node.tagName === "A") {
    const href = node.getAttribute("href") ?? "";
    if (!/^https?:\/\//i.test(href)) node.removeAttribute("href");
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  }
});

export function Markdown({ text, onCite, className }: { text: string; onCite?: (label: string) => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const html = useMemo(() => rawHtml(text, Boolean(onCite)), [text, onCite]);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Trusted Types: the HTML reaches the DOM only as DOMPurify's TrustedHTML.
    el.innerHTML = DOMPurify.sanitize(html, { ...CONFIG, RETURN_TRUSTED_TYPE: true }) as unknown as string;
  }, [html]);
  return (
    <div
      ref={ref}
      className={`prose ${className ?? ""}`}
      onClick={(e) => {
        const b = (e.target as HTMLElement).closest<HTMLElement>("[data-cite]");
        if (b && onCite) onCite(b.dataset.cite!);
      }}
    />
  );
}
