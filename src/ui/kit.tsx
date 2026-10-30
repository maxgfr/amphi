// Small building blocks shared by every screen.

import { type ReactNode, useEffect, useId, useRef } from "react";
import { useLang } from "../i18n.ts";
import { Icon, type IconName } from "./icons.tsx";

/** A modal sheet on <dialog>: focus is trapped, Escape closes it. */
export function Sheet({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  const { t } = useLang();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      // showModal focuses the close button; start in the field marked data-autofocus, else the first one.
      (d.querySelector<HTMLElement>(".sheet-body [data-autofocus]") ?? d.querySelector<HTMLElement>(".sheet-body :is(input, textarea, select):not(:disabled, [type=hidden], [type=checkbox], [type=radio])"))?.focus();
    }
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} className={`sheet${wide ? " wide" : ""}`} aria-labelledby={id} onClose={onClose} onCancel={onClose}>
      <div className="sheet-head">
        <h2 id={id}>{title}</h2>
        <button type="button" className="icon-button" onClick={onClose} aria-label={t("Close", "Fermer", "Schließen")}>
          <Icon name="x" />
        </button>
      </div>
      {open ? <div className="sheet-body">{children}</div> : null}
    </dialog>
  );
}

export function Tabs<K extends string>({ tabs, value, onChange, label }: { tabs: { id: K; label: string; icon?: IconName; count?: number }[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={tab.id === value}
          tabIndex={tab.id === value ? 0 : -1}
          onClick={() => onChange(tab.id)}
          onKeyDown={(e) => {
            const i = tabs.findIndex((x) => x.id === value);
            const next = e.key === "ArrowRight" ? tabs[(i + 1) % tabs.length] : e.key === "ArrowLeft" ? tabs[(i - 1 + tabs.length) % tabs.length] : null;
            if (next) {
              e.preventDefault();
              onChange(next.id);
              (e.currentTarget.parentElement?.querySelector(`[data-tab="${next.id}"]`) as HTMLElement | null)?.focus();
            }
          }}
          data-tab={tab.id}
        >
          {tab.icon ? <Icon name={tab.icon} size={18} /> : null}
          <span>{tab.label}</span>
          {tab.count ? <span className="count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: IconName; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={28} />
      <p className="empty-title">{title}</p>
      {children}
    </div>
  );
}

export function ProgressBar({ ratio, label }: { ratio?: number; label?: string }) {
  return (
    <div className="progress" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={ratio === undefined ? undefined : Math.round(ratio * 100)}>
      <div className={ratio === undefined ? "bar indeterminate" : "bar"} style={ratio === undefined ? undefined : { inlineSize: `${Math.round(ratio * 100)}%` }} />
    </div>
  );
}

/** A notice: "info" for what is about to leave the device, "error" for failures. */
export function Notice({ kind = "info", children }: { kind?: "info" | "error" | "ok"; children: ReactNode }) {
  return (
    <div className={`notice ${kind}`} role={kind === "error" ? "alert" : undefined}>
      {children}
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  );
}

export function Segmented<K extends string>({ options, value, onChange, label }: { options: { id: K; label: string }[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.id} type="button" aria-pressed={o.id === value} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** Download a file the app made. */
export function saveFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** A file name from a title: letters, digits and dashes. */
export function slug(s: string, fallback = "amphi"): string {
  const out = s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return out || fallback;
}
