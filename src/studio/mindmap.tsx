// Mind maps: a tree of ideas made from a lesson or a whole course, drawn in
// our own SVG and edited in place (rename, add, delete, move, collapse) with
// the mouse or the keyboard, zoomed and panned, readable as an outline, and
// exported as SVG, PNG or a Markdown outline.

import { type KeyboardEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { budgetFor, buildContext } from "../ai/context.ts";
import { capabilities, writeIn } from "../ai/llm.ts";
import { askJson } from "../ai/structured.ts";
import { type T, trIn, useLang } from "../i18n.ts";
import { openCitation } from "../ui/cite.ts";
import { Icon } from "../ui/icons.tsx";
import { Field, slug } from "../ui/kit.tsx";
import { edgePath, type Layout, layoutTree } from "./render/mindmap-layout.ts";
import { boxColours, lineYs, mindmapScene } from "./render/mindmap-svg.ts";
import {
  addChild,
  addSibling,
  find,
  fromRaw,
  indent,
  MAX_DEPTH,
  MindmapAnswer,
  type MindmapData,
  type MindNode,
  moveAmongSiblings,
  neighbour,
  newNodeId,
  outdent,
  removeNode,
  rename,
  SHAPE,
  toggle,
  toOutline,
} from "./render/mindmap-tree.ts";
import { pngBlob, svgBlob } from "./render/svg.ts";
import { kind, type OptionsProps, type ViewProps } from "./types.ts";

export interface MindmapOptions extends Record<string, unknown> {
  detail: "compact" | "detailed";
  focus: string;
}

function Options({ value, onChange }: OptionsProps<MindmapOptions>) {
  const { t } = useLang();
  return (
    <div className="stack">
      <Field label={t("Detail", "Niveau de détail", "Detailgrad")}>
        <select value={value.detail} onChange={(e) => onChange({ ...value, detail: e.currentTarget.value as MindmapOptions["detail"] })}>
          <option value="compact">{t("Compact: the main ideas", "Compact : les idées principales", "Kompakt: die Hauptideen")}</option>
          <option value="detailed">{t("Detailed: down to the examples", "Détaillé : jusqu'aux exemples", "Ausführlich: bis zu den Beispielen")}</option>
        </select>
      </Field>
      <Field label={t("Focus (optional)", "Angle (facultatif)", "Schwerpunkt (optional)")}>
        <input value={value.focus} onChange={(e) => onChange({ ...value, focus: e.currentTarget.value })} placeholder={t("e.g. the causes, chapter 2", "ex. les causes, le chapitre 2", "z. B. die Ursachen, Kapitel 2")} />
      </Field>
    </div>
  );
}

interface ViewState {
  x: number;
  y: number;
  k: number;
}

const clampK = (k: number) => Math.min(3, Math.max(0.2, k));

function fitView(layout: Layout, el: HTMLElement | null): ViewState {
  const w = el?.clientWidth || 800;
  const h = el?.clientHeight || 480;
  const k = clampK(Math.min(1.2, w / layout.width, h / layout.height));
  return { k, x: (w - layout.width * k) / 2, y: (h - layout.height * k) / 2 };
}

function View({ artifact, onChange }: ViewProps<MindmapData>) {
  const { t } = useLang();
  const [root, setRoot] = useState(artifact.data.root);
  const [selected, setSelected] = useState(artifact.data.root.id);
  const [editing, setEditing] = useState<string | null>(null);
  const [outline, setOutline] = useState(false);
  const [view, setView] = useState<ViewState>({ x: 0, y: 0, k: 1 });
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const nodeRefs = useRef(new Map<string, SVGGElement>());
  const wantFocus = useRef(false);
  const layout = useMemo(() => layoutTree(root), [root]);
  const sel = find(root, selected) ?? find(root, root.id)!;

  // A regeneration brings a new tree.
  useEffect(() => {
    setRoot(artifact.data.root);
    setSelected(artifact.data.root.id);
  }, [artifact.version]);

  // Fit once the canvas has a size, and again when coming back from the outline.
  useLayoutEffect(() => {
    if (!outline) setView(fitView(layout, wrapRef.current));
  }, [outline]);

  useEffect(() => {
    // Not while renaming: the field has the focus.
    if (!wantFocus.current || editing) return;
    wantFocus.current = false;
    nodeRefs.current.get(selected)?.focus();
  }, [selected, layout, editing]);

  // Wheel zoom needs a non-passive listener to keep the page from scrolling.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [outline]);

  const save = (next: MindNode) => {
    setRoot(next);
    onChange({ ...artifact.data, root: next });
  };
  const select = (id: string | undefined, focus = true) => {
    if (!id) return;
    wantFocus.current = focus;
    setSelected(id);
  };
  const zoomAt = (factor: number, cx?: number, cy?: number) =>
    setView((v) => {
      const k = clampK(v.k * factor);
      const px = cx ?? (wrapRef.current?.clientWidth ?? 800) / 2;
      const py = cy ?? (wrapRef.current?.clientHeight ?? 480) / 2;
      return { k, x: px - ((px - v.x) * k) / v.k, y: py - ((py - v.y) * k) / v.k };
    });
  const pan = (dx: number, dy: number) => setView((v) => ({ ...v, x: v.x + dx, y: v.y + dy }));
  const fit = () => setView(fitView(layout, wrapRef.current));

  const newIdea = t("New idea", "Nouvelle idée", "Neue Idee");
  const act = {
    child: () => {
      const n: MindNode = { id: newNodeId(), title: newIdea, children: [] };
      save(addChild(root, sel.node.id, n));
      select(n.id);
      setEditing(n.id);
    },
    sibling: () => {
      const n: MindNode = { id: newNodeId(), title: newIdea, children: [] };
      save(addSibling(root, sel.node.id, n));
      select(n.id);
      setEditing(n.id);
    },
    remove: () => {
      if (!sel.parent) return;
      const next = sel.parent.children[sel.index + 1] ?? sel.parent.children[sel.index - 1] ?? sel.parent;
      save(removeNode(root, sel.node.id));
      select(next.id);
    },
    up: () => (save(moveAmongSiblings(root, sel.node.id, -1)), select(sel.node.id)),
    down: () => (save(moveAmongSiblings(root, sel.node.id, 1)), select(sel.node.id)),
    outdent: () => (save(outdent(root, sel.node.id)), select(sel.node.id)),
    indent: () => (save(indent(root, sel.node.id)), select(sel.node.id)),
    toggle: () => (save(toggle(root, sel.node.id)), select(sel.node.id)),
  };

  const onKey = (e: KeyboardEvent<SVGSVGElement>) => {
    if (editing) return;
    const k = e.key;
    let done = true;
    if (e.shiftKey && k.startsWith("Arrow")) pan(k === "ArrowLeft" ? 60 : k === "ArrowRight" ? -60 : 0, k === "ArrowUp" ? 60 : k === "ArrowDown" ? -60 : 0);
    else if (e.altKey && k === "ArrowUp") act.up();
    else if (e.altKey && k === "ArrowDown") act.down();
    else if (e.altKey && k === "ArrowLeft") act.outdent();
    else if (e.altKey && k === "ArrowRight") act.indent();
    else if (k === "ArrowUp" || k === "ArrowDown" || k === "ArrowLeft" || k === "ArrowRight") {
      if (k === "ArrowRight" && sel.node.collapsed) act.toggle();
      else select(neighbour(root, sel.node.id, k));
    } else if (k === "Enter" && e.shiftKey) act.sibling();
    else if (k === "Insert" || (k === "Enter" && (e.ctrlKey || e.metaKey))) act.child();
    else if (k === "Enter" || k === "F2") setEditing(sel.node.id);
    else if (k === "Delete" || k === "Backspace") act.remove();
    else if (k === " ") act.toggle();
    else if (k === "+" || k === "=") zoomAt(1.2);
    else if (k === "-" || k === "_") zoomAt(1 / 1.2);
    else if (k === "0") fit();
    else done = false;
    if (done) e.preventDefault();
  };

  // Dragging the background pans.
  const drag = useRef<{ x: number; y: number } | null>(null);
  const editBox = editing ? layout.boxes.find((b) => b.id === editing) : undefined;
  const label = t("Mind map", "Carte mentale", "Mindmap");

  return (
    <div className="stack mindmap">
      <div className="row wrap no-print mm-toolbar" role="toolbar" aria-label={t("Mind map tools", "Outils de la carte", "Mindmap-Werkzeuge")}>
        <div className="segmented small" role="group" aria-label={t("Show as", "Afficher en", "Anzeigen als")}>
          <button type="button" aria-pressed={!outline} onClick={() => setOutline(false)}>
            {t("Map", "Carte", "Karte")}
          </button>
          <button type="button" aria-pressed={outline} onClick={() => setOutline(true)}>
            {t("Outline", "Plan", "Gliederung")}
          </button>
        </div>
        {!outline ? (
          <>
            <button type="button" className="secondary small" onClick={() => zoomAt(1 / 1.2)} aria-label={t("Zoom out", "Dézoomer", "Verkleinern")}>
              −
            </button>
            <span className="meta mm-zoom" aria-live="polite">
              {Math.round(view.k * 100)} %
            </span>
            <button type="button" className="secondary small" onClick={() => zoomAt(1.2)} aria-label={t("Zoom in", "Zoomer", "Vergrößern")}>
              +
            </button>
            <button type="button" className="secondary small" onClick={fit}>
              {t("Fit to screen", "Ajuster à l'écran", "An Bildschirm anpassen")}
            </button>
            <span className="mm-sep" aria-hidden="true" />
            <button type="button" className="secondary small" onClick={() => setEditing(sel.node.id)}>
              <Icon name="edit" size={16} /> {t("Rename", "Renommer", "Umbenennen")}
            </button>
            <button type="button" className="secondary small" onClick={act.child}>
              <Icon name="plus" size={16} /> {t("Child", "Enfant", "Unterpunkt")}
            </button>
            <button type="button" className="secondary small" onClick={act.sibling}>
              <Icon name="plus" size={16} /> {t("Sibling", "Voisin", "Nachbar")}
            </button>
            <button type="button" className="secondary small" onClick={act.up} disabled={!sel.parent || sel.index === 0} aria-label={t("Move up", "Monter", "Nach oben")}>
              ↑
            </button>
            <button type="button" className="secondary small" onClick={act.down} disabled={!sel.parent || sel.index === sel.parent.children.length - 1} aria-label={t("Move down", "Descendre", "Nach unten")}>
              ↓
            </button>
            <button type="button" className="secondary small" onClick={act.outdent} disabled={!sel.parent || sel.depth < 2} aria-label={t("Move one level up", "Remonter d'un niveau", "Eine Ebene höher")}>
              ←
            </button>
            <button type="button" className="secondary small" onClick={act.indent} disabled={!sel.parent || sel.index === 0} aria-label={t("Move one level down", "Descendre d'un niveau", "Eine Ebene tiefer")}>
              →
            </button>
            <button type="button" className="secondary small" onClick={act.remove} disabled={!sel.parent} aria-label={t("Delete the idea", "Supprimer l'idée", "Idee löschen")}>
              <Icon name="trash" size={16} />
            </button>
          </>
        ) : null}
      </div>

      {outline ? (
        <Outline root={root} sourceIds={artifact.sourceIds} />
      ) : (
        <>
          <div className="mm-wrap" ref={wrapRef}>
            <svg
              ref={svgRef}
              className="mm-canvas"
              role="tree"
              aria-label={`${label}: ${root.title}`}
              onKeyDown={onKey}
              onPointerDown={(e) => {
                if ((e.target as Element).closest("[data-node]")) return;
                drag.current = { x: e.clientX, y: e.clientY };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!drag.current) return;
                pan(e.clientX - drag.current.x, e.clientY - drag.current.y);
                drag.current = { x: e.clientX, y: e.clientY };
              }}
              onPointerUp={() => {
                drag.current = null;
              }}
            >
              <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
                {layout.boxes.map((b) => {
                  const p = b.parentId ? layout.boxes.find((x) => x.id === b.parentId) : undefined;
                  return p ? <path key={`e${b.id}`} d={edgePath(p, b)} className={`mm-edge sc-s-b${b.branch % 6}`} /> : null;
                })}
                {layout.boxes.map((b) => {
                  const c = boxColours(b);
                  const f = find(root, b.id)!;
                  const isSel = b.id === sel.node.id;
                  return (
                    <g
                      key={b.id}
                      data-node={b.id}
                      ref={(el) => {
                        if (el) nodeRefs.current.set(b.id, el);
                        else nodeRefs.current.delete(b.id);
                      }}
                      role="treeitem"
                      aria-level={b.depth + 1}
                      aria-setsize={f.parent ? f.parent.children.length : 1}
                      aria-posinset={f.index + 1}
                      aria-expanded={b.node.children.length ? !b.node.collapsed : undefined}
                      aria-selected={isSel}
                      aria-label={b.node.title}
                      tabIndex={isSel ? 0 : -1}
                      className={`mm-node${isSel ? " selected" : ""}`}
                      onClick={() => select(b.id)}
                      onDoubleClick={() => {
                        select(b.id);
                        setEditing(b.id);
                      }}
                    >
                      <rect x={b.x} y={b.y} width={b.w} height={b.h} rx={8} className={`sc-f-${c.fill} sc-s-${c.stroke}`} strokeWidth={b.depth === 0 ? 0 : 1.5} />
                      {isSel ? <rect x={b.x - 4} y={b.y - 4} width={b.w + 8} height={b.h + 8} rx={11} className="mm-ring" /> : null}
                      {lineYs(b).map((y, i) => (
                        <text key={y} x={b.x + 12} y={y} fontSize={b.size} fontWeight={b.weight} dominantBaseline="middle" className={`sc-f-${c.text}`}>
                          {b.lines[i]}
                        </text>
                      ))}
                      {b.node.children.length ? (
                        // The keyboard folds with Space on the node itself.
                        <g
                          className="mm-toggle"
                          onClick={(e) => {
                            e.stopPropagation();
                            save(toggle(root, b.id));
                            select(b.id);
                          }}
                        >
                          <circle cx={b.x + b.w} cy={b.y + b.h / 2} r={b.hidden ? 11 : 7} className={`sc-f-surface sc-s-${b.depth === 0 ? "accent" : `b${b.branch % 6}`}`} strokeWidth={1.5} />
                          <text x={b.x + b.w} y={b.y + b.h / 2} fontSize={b.hidden ? 10 : 11} fontWeight={600} textAnchor="middle" dominantBaseline="central" className="sc-f-muted">
                            {b.hidden ? `+${b.hidden}` : "−"}
                          </text>
                        </g>
                      ) : null}
                    </g>
                  );
                })}
              </g>
            </svg>
            {editBox ? (
              <input
                className="mm-rename"
                // Positioned over the node being renamed, in screen pixels.
                style={{ left: editBox.x * view.k + view.x, top: editBox.y * view.k + view.y, width: Math.max(160, editBox.w * view.k), height: Math.max(32, editBox.h * view.k), fontSize: editBox.size * Math.max(0.8, view.k) }}
                aria-label={t("Name of the idea", "Nom de l'idée", "Name der Idee")}
                defaultValue={editBox.node.title}
                ref={(el) => {
                  if (el && document.activeElement !== el) {
                    el.focus();
                    el.select();
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    save(rename(root, editBox.id, e.currentTarget.value));
                    setEditing(null);
                    select(editBox.id);
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.stopPropagation();
                    setEditing(null);
                    select(editBox.id);
                  }
                }}
                onBlur={(e) => {
                  if (editing !== editBox.id) return;
                  save(rename(root, editBox.id, e.currentTarget.value));
                  setEditing(null);
                }}
              />
            ) : null}
          </div>
          <div className="mm-details" aria-live="polite">
            <strong>{sel.node.title}</strong>
            {sel.node.note ? <span> {sel.node.note}</span> : null}
            {sel.node.cite ? (
              <>
                {" "}
                <button type="button" className="cite" onClick={() => openCitation(sel.node.cite!, artifact.sourceIds)}>
                  {sel.node.cite}
                </button>
              </>
            ) : null}
          </div>
          <details className="disclosure no-print">
            <summary>{t("Keyboard shortcuts", "Raccourcis clavier", "Tastenkürzel")}</summary>
            <ul className="mm-keys">
              <li>{t("Arrows: move between ideas; Space: fold or unfold", "Flèches : passer d'une idée à l'autre ; Espace : replier ou déplier", "Pfeiltasten: zwischen Ideen wechseln; Leertaste: ein- oder ausklappen")}</li>
              <li>{t("Enter or F2: rename (or double-click)", "Entrée ou F2 : renommer (ou double-clic)", "Eingabe oder F2: umbenennen (oder Doppelklick)")}</li>
              <li>{t("Ctrl+Enter or Insert: add a child; Shift+Enter: add a sibling; Delete: delete", "Ctrl+Entrée ou Inser : ajouter un enfant ; Maj+Entrée : ajouter un voisin ; Suppr : supprimer", "Strg+Eingabe oder Einfg: Unterpunkt; Umschalt+Eingabe: Nachbar; Entf: löschen")}</li>
              <li>{t("Alt+arrows: move the idea; Shift+arrows: pan; + and −: zoom; 0: fit", "Alt+flèches : déplacer l'idée ; Maj+flèches : se déplacer ; + et − : zoomer ; 0 : ajuster", "Alt+Pfeile: Idee verschieben; Umschalt+Pfeile: verschieben der Ansicht; + und −: zoomen; 0: anpassen")}</li>
            </ul>
          </details>
        </>
      )}
    </div>
  );
}

function Outline({ root, sourceIds }: { root: MindNode; sourceIds: string[] }) {
  const item = (n: MindNode) => (
    <li key={n.id}>
      <span className="mm-outline-title">{n.title}</span>
      {n.note ? <span className="meta"> {n.note}</span> : null}
      {n.cite ? (
        <>
          {" "}
          <button type="button" className="cite" onClick={() => openCitation(n.cite!, sourceIds)}>
            {n.cite}
          </button>
        </>
      ) : null}
      {n.children.length ? <ul>{n.children.map(item)}</ul> : null}
    </li>
  );
  return (
    <div className="prose mm-outline">
      <h2>{root.title}</h2>
      {root.note ? <p>{root.note}</p> : null}
      <ul>{root.children.map(item)}</ul>
    </div>
  );
}

const title = (t: T, course: string, lesson?: string) => `${t("Mind map", "Carte mentale", "Mindmap")} · ${lesson ?? course}`;

export const mindmap = kind<MindmapData, MindmapOptions>({
  type: "mindmap",
  icon: "mindmap",
  label: (t) => t("Mind map", "Carte mentale", "Mindmap"),
  blurb: (t) => t("The ideas of a lesson or a course as a tree you can edit", "Les idées d'une leçon ou d'un cours en arbre modifiable", "Die Ideen einer Lektion oder eines Kurses als bearbeitbarer Baum"),
  defaults: { detail: "compact", focus: "" },
  Options,
  async generate(ctx, o) {
    ctx.progress({ label: "" });
    const context = buildContext(ctx.sources, { query: o.focus || undefined, budget: budgetFor(capabilities().contextWindow) });
    const size = o.detail === "compact" ? "3 to 6 main branches, each with 2 to 4 sub-ideas, 3 levels in all" : `4 to 7 main branches, each with 3 to 5 sub-ideas and their own details, at most ${MAX_DEPTH} levels in all`;
    const raw = await askJson(MindmapAnswer, {
      system: `You draw a mind map of a university student's course material from their own sources. The central node is the subject of the sources; ${size}. Node titles are short (2 to 6 words); a node may carry a one-sentence "note". Every node but the central one has "cite": the label of the passage it comes from, exactly as in the sources (e.g. "S1 p.3", "S2 12:34", "S3 §2"). Use only what the sources say. Write in ${writeIn(ctx.language)}.`,
      prompt: `${o.focus ? `Focus on: ${o.focus}\n\n` : ""}${context.text}`,
      shape: SHAPE,
      signal: ctx.signal,
    });
    return { title: title(trIn(ctx.language), ctx.course.title, ctx.lesson?.title), data: { root: fromRaw(raw) } };
  },
  View,
  exports: [
    {
      id: "svg",
      label: (t) => t("SVG image", "Image SVG", "SVG-Bild"),
      run: async (a) => ({ blob: svgBlob(mindmapScene(layoutTree(a.data.root), a.data.root)), filename: `${slug(a.title)}.svg` }),
    },
    {
      id: "png",
      label: (t) => t("PNG image", "Image PNG", "PNG-Bild"),
      run: async (a) => ({ blob: await pngBlob(mindmapScene(layoutTree(a.data.root), a.data.root)), filename: `${slug(a.title)}.png` }),
    },
    {
      id: "md",
      label: (t) => t("Markdown outline", "Plan Markdown", "Markdown-Gliederung"),
      run: async (a) => ({ blob: new Blob([toOutline(a.data.root)], { type: "text/markdown" }), filename: `${slug(a.title)}.md` }),
    },
  ],
});
