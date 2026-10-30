// A scene drawn in the page: colours come from CSS classes over the theme's
// custom properties (light and dark), citations become buttons.

import type { KeyboardEvent } from "react";
import type { Role, Scene, Shape } from "./svg.ts";

const fill = (r?: Role) => (r ? `sc-f-${r}` : "sc-f-none");
const stroke = (r?: Role) => (r ? `sc-s-${r}` : "sc-s-none");

function ShapeEl({ s, onCite }: { s: Shape; onCite?: (label: string) => void }) {
  switch (s.kind) {
    case "rect":
      return <rect x={s.x} y={s.y} width={s.w} height={s.h} rx={s.r ?? 0} className={`${fill(s.fill)} ${stroke(s.stroke)}`} strokeWidth={s.strokeWidth ?? 1} />;
    case "circle":
      return <circle cx={s.cx} cy={s.cy} r={s.r} className={`${fill(s.fill)} ${stroke(s.stroke)}`} strokeWidth={s.strokeWidth ?? 1} />;
    case "line":
      return <line x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} className={stroke(s.stroke)} strokeWidth={s.strokeWidth ?? 1} strokeDasharray={s.dash ? "4 4" : undefined} />;
    case "path":
      return <path d={s.d} className={`${fill(s.fill)} ${stroke(s.stroke)}`} strokeWidth={s.strokeWidth ?? 1} strokeLinecap="round" />;
    case "text": {
      const text = (
        <text x={s.x} y={s.y} fontSize={s.size} fontWeight={s.weight ?? 400} textAnchor={s.anchor ?? "start"} dominantBaseline="middle" className={fill(s.fill)}>
          {s.text}
        </text>
      );
      if (!s.cite || !onCite) return text;
      const cite = s.cite;
      const open = () => onCite(cite);
      return (
        <g
          role="button"
          tabIndex={0}
          className="sc-cite"
          aria-label={cite}
          onClick={open}
          onKeyDown={(e: KeyboardEvent) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              open();
            }
          }}
        >
          {text}
        </g>
      );
    }
  }
}

export function SceneSvg({ scene, onCite, className }: { scene: Scene; onCite?: (label: string) => void; className?: string }) {
  return (
    <svg className={`scene ${className ?? ""}`} viewBox={`0 0 ${scene.width} ${scene.height}`} width={scene.width} height={scene.height} role={onCite ? "group" : "img"} aria-label={scene.title}>
      <title>{scene.title}</title>
      {/* A group reads its own texts; an image needs the description. */}
      {scene.desc && !onCite ? <desc>{scene.desc}</desc> : null}
      <rect x={0} y={0} width={scene.width} height={scene.height} className={fill(scene.background ?? "bg")} />
      {scene.shapes.map((s, i) => (
        // Shapes have no identity of their own: the scene is redrawn whole.
        // oxlint-disable-next-line react/no-array-index-key
        <ShapeEl key={i} s={s} onCite={onCite} />
      ))}
    </svg>
  );
}
