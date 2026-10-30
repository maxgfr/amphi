// Sync settings: a GitHub repository (plain files or end-to-end encrypted),
// a folder on this computer, and zip backups.

import { useEffect, useRef, useState } from "react";
import { getMeta, setMeta } from "../data/db.ts";
import { bytes, count, relative, type T, useLang } from "../i18n.ts";
import { deleteSecret, setSecret } from "../secrets.ts";
import { Field, Notice, saveFile, Segmented } from "../ui/kit.tsx";
import type { Header } from "./files.ts";
import type { GitHubCheck } from "./github.ts";
import { loadSync, PASSPHRASE_SECRET, saveConfig, type SyncConfig, type SyncStatus, syncNow, TOKEN_SECRET, useSyncStatus } from "./run.ts";

const FOLDER_KEY = "sync-folder";

export function SyncSettings() {
  const s = useSyncStatus();
  const { t } = useLang();
  useEffect(() => {
    void loadSync();
  }, []);
  if (!s.loaded) return <div aria-busy="true" />;
  return (
    <div className="stack">
      <p className="lead">
        {t(
          "Keep your courses on your other devices through a private GitHub repository of your own: in readable files, or end-to-end encrypted. Or keep a copy in a folder, or as a zip.",
          "Retrouvez vos cours sur vos autres appareils grâce à un dépôt GitHub privé, à vous : en fichiers lisibles, ou chiffrés de bout en bout. Ou gardez une copie dans un dossier, ou en zip.",
          "Ihre Kurse auf Ihren anderen Geräten, über ein eigenes privates GitHub-Repository: als lesbare Dateien oder Ende-zu-Ende-verschlüsselt. Oder als Kopie in einem Ordner oder als ZIP.",
        )}
      </p>
      <h2 className="section-title">GitHub</h2>
      {s.config ? <Connected s={s} config={s.config} /> : <Connect />}
      <h2 className="section-title">{t("Folder on this computer", "Dossier sur cet ordinateur", "Ordner auf diesem Computer")}</h2>
      <LocalFolder />
      <h2 className="section-title">{t("Zip backup", "Sauvegarde zip", "ZIP-Sicherung")}</h2>
      <ZipBackup />
    </div>
  );
}

function checkProblem(t: T, c: Extract<GitHubCheck, { ok: false }>): string {
  switch (c.problem) {
    case "token":
      return t("GitHub refused this token: check it was copied whole and has not expired.", "GitHub refuse ce jeton : vérifiez qu'il a été copié en entier et n'a pas expiré.", "GitHub lehnt dieses Token ab: Prüfen Sie, ob es vollständig kopiert wurde und nicht abgelaufen ist.");
    case "not-found":
      return t("No GitHub account has this name.", "Aucun compte GitHub ne porte ce nom.", "Kein GitHub-Konto trägt diesen Namen.");
    case "no-access":
      return t("This repository does not exist, or the token was not given access to it.", "Ce dépôt n'existe pas, ou le jeton n'y a pas accès.", "Dieses Repository existiert nicht, oder das Token hat keinen Zugriff darauf.");
    case "read-only":
      return t("The token can read this repository but not write to it: give it Contents, read and write.", "Le jeton peut lire ce dépôt mais pas y écrire : donnez-lui Contents en lecture et écriture.", "Das Token kann dieses Repository lesen, aber nicht schreiben: Geben Sie ihm Contents mit Lesen und Schreiben.");
    case "rate-limited":
      return t("GitHub asks to wait a moment. Try again shortly.", "GitHub demande de patienter un moment. Réessayez bientôt.", "GitHub bittet um etwas Geduld. Versuchen Sie es gleich noch einmal.");
    case "network":
      return t("GitHub could not be reached. Check your connection.", "GitHub est injoignable. Vérifiez votre connexion.", "GitHub ist nicht erreichbar. Prüfen Sie Ihre Verbindung.");
  }
}

function errorText(t: T, e: NonNullable<SyncStatus["error"]>): string {
  switch (e.kind) {
    case "auth":
      return t("GitHub refused the token: it may have expired. Replace it below.", "GitHub refuse le jeton : il a peut-être expiré. Remplacez-le ci-dessous.", "GitHub lehnt das Token ab: Es ist vielleicht abgelaufen. Ersetzen Sie es unten.");
    case "not-found":
    case "permission":
      return t("The repository cannot be reached with this token, or the token cannot write to it.", "Le dépôt est inaccessible avec ce jeton, ou le jeton ne peut pas y écrire.", "Das Repository ist mit diesem Token nicht erreichbar, oder das Token darf nicht schreiben.");
    case "rate-limited": {
      const min = Math.max(1, Math.round((e.retryAfterMs ?? 60_000) / 60_000));
      return t(`GitHub asks to wait about ${min} min; sync will try again by itself.`, `GitHub demande d'attendre environ ${min} min ; la synchro réessaiera d'elle-même.`, `GitHub bittet, etwa ${min} Min. zu warten; die Synchronisierung versucht es dann selbst erneut.`);
    }
    case "network":
    case "conflict":
      return t("GitHub could not be reached, or was busy. Sync will try again.", "GitHub était injoignable ou occupé. La synchro réessaiera.", "GitHub war nicht erreichbar oder beschäftigt. Die Synchronisierung versucht es erneut.");
    case "passphrase":
      return t("The passphrase on this device does not open this repository.", "La phrase de passe de cet appareil n'ouvre pas ce dépôt.", "Die Passphrase auf diesem Gerät öffnet dieses Repository nicht.");
    case "locked":
      return t("Your keys are locked: unlock them to sync.", "Vos clés sont verrouillées : déverrouillez-les pour synchroniser.", "Ihre Schlüssel sind gesperrt: Entsperren Sie sie zum Synchronisieren.");
    case "format":
      return t(`This repository cannot be read: ${e.message}`, `Ce dépôt ne peut pas être lu : ${e.message}`, `Dieses Repository kann nicht gelesen werden: ${e.message}`);
    default:
      return t(`Sync failed: ${e.message}`, `La synchro a échoué : ${e.message}`, `Synchronisierung fehlgeschlagen: ${e.message}`);
  }
}

const modeLabel = (t: T, mode: "plain" | "encrypted") => (mode === "plain" ? t("Readable files", "Fichiers lisibles", "Lesbare Dateien") : t("End-to-end encrypted", "Chiffré de bout en bout", "Ende-zu-Ende-verschlüsselt"));

type Found = { config: Omit<SyncConfig, "mode" | "media" | "auto">; token: string; header: Header | null };

function Connect() {
  const { t } = useLang();
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("");
  const [folder, setFolder] = useState("amphi");
  const [token, setToken] = useState("");
  const [found, setFound] = useState<Found | null>(null);
  const [mode, setMode] = useState<"plain" | "encrypted">("plain");
  const [pass, setPass] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState("");
  const [modules, setModules] = useState<{ gh: typeof import("./github.ts"); engine: typeof import("./engine.ts") } | null>(null);
  useEffect(() => {
    void Promise.all([import("./github.ts"), import("./engine.ts")]).then(([gh, engine]) => setModules({ gh, engine }));
  }, []);
  const parsed = modules?.gh.parseRepo(repo) ?? null;

  const check = async () => {
    if (!modules) return;
    setProblem("");
    setFound(null);
    if (!parsed) return setProblem(t("Write the repository as owner/name, or paste its address.", "Écrivez le dépôt sous la forme propriétaire/nom, ou collez son adresse.", "Geben Sie das Repository als Besitzer/Name an oder fügen Sie seine Adresse ein."));
    setBusy(true);
    try {
      const target = { ...parsed, branch: branch.trim(), folder: modules.gh.normalizeFolder(folder), token: token.trim() };
      const c = await modules.gh.checkGitHub(target);
      if (!c.ok) return setProblem(checkProblem(t, c));
      const header = await modules.engine.probe(modules.gh.github(target));
      setFound({ config: { owner: parsed.owner, repo: parsed.repo, branch: target.branch, folder: target.folder }, token: target.token, header });
      if (header) setMode(header.mode);
    } catch (e) {
      setProblem(t(`The repository could not be read: ${(e as Error).message}`, `Le dépôt n'a pas pu être lu : ${(e as Error).message}`, `Das Repository konnte nicht gelesen werden: ${(e as Error).message}`));
    } finally {
      setBusy(false);
    }
  };

  const connect = async () => {
    if (!found || !modules) return;
    setProblem("");
    const encrypted = (found.header?.mode ?? mode) === "encrypted";
    if (encrypted && !found.header && pass !== again) return setProblem(t("The two passphrases differ.", "Les deux phrases de passe diffèrent.", "Die beiden Passphrasen unterscheiden sich."));
    if (encrypted && !found.header && pass.length < 12) return setProblem(t("Use at least 12 characters.", "Utilisez au moins 12 caractères.", "Verwenden Sie mindestens 12 Zeichen."));
    setBusy(true);
    try {
      if (encrypted && found.header && !(await modules.engine.verifyPassphrase(found.header, pass))) {
        return setProblem(t("This passphrase does not open this repository.", "Cette phrase de passe n'ouvre pas ce dépôt.", "Diese Passphrase öffnet dieses Repository nicht."));
      }
      await setSecret(TOKEN_SECRET, found.token);
      if (encrypted) await setSecret(PASSPHRASE_SECRET, pass);
      else await deleteSecret(PASSPHRASE_SECRET);
      await saveConfig({ ...found.config, mode: found.header?.mode ?? mode, media: true, auto: true });
      await syncNow();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="stack">
      <ol className="steps">
        <li>
          {t("Create a private repository on GitHub (empty is fine).", "Créez un dépôt privé sur GitHub (vide, c'est bien).", "Legen Sie auf GitHub ein privates Repository an (leer ist in Ordnung).")}{" "}
          <a href="https://github.com/new" target="_blank" rel="noopener noreferrer">
            {t("New repository", "Nouveau dépôt", "Neues Repository")}
          </a>
        </li>
        <li>
          {t("Create a fine-grained token for that repository only, with Contents: read and write.", "Créez un jeton à granularité fine pour ce seul dépôt, avec Contents : lecture et écriture.", "Erstellen Sie ein fein granuliertes Token nur für dieses Repository, mit Contents: Lesen und Schreiben.")}{" "}
          <a href={modules?.gh.tokenUrl(parsed?.owner) ?? "https://github.com/settings/personal-access-tokens/new"} target="_blank" rel="noopener noreferrer">
            {t("Create the token", "Créer le jeton", "Token erstellen")}
          </a>
        </li>
      </ol>
      <Field label={t("Repository", "Dépôt", "Repository")} hint={t("owner/name, or its address", "propriétaire/nom, ou son adresse", "Besitzer/Name oder seine Adresse")}>
        <input type="text" spellCheck={false} autoCapitalize="off" value={repo} placeholder="ada/amphi-data" onChange={(e) => (setRepo(e.currentTarget.value), setFound(null))} />
      </Field>
      <div className="row">
        <Field label={t("Branch", "Branche", "Branch")} hint={t("Empty: the default branch", "Vide : la branche par défaut", "Leer: der Standard-Branch")}>
          <input type="text" spellCheck={false} value={branch} onChange={(e) => (setBranch(e.currentTarget.value), setFound(null))} />
        </Field>
        <Field label={t("Folder", "Dossier", "Ordner")} hint={t("Inside the repository", "Dans le dépôt", "Im Repository")}>
          <input type="text" spellCheck={false} value={folder} onChange={(e) => (setFolder(e.currentTarget.value), setFound(null))} />
        </Field>
      </div>
      <Field label={t("Token", "Jeton", "Token")} hint={t("Encrypted on this device, sent only to GitHub.", "Chiffré sur cet appareil, envoyé seulement à GitHub.", "Auf diesem Gerät verschlüsselt, nur an GitHub gesendet.")}>
        <input type="password" autoComplete="off" spellCheck={false} value={token} onChange={(e) => (setToken(e.currentTarget.value), setFound(null))} />
      </Field>
      {!found ? (
        <div className="row">
          <button type="button" className="secondary" disabled={busy || !repo.trim() || !token.trim() || !modules} onClick={() => void check()}>
            {busy ? t("Checking…", "Vérification…", "Prüfung…") : t("Check", "Vérifier", "Prüfen")}
          </button>
        </div>
      ) : (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void connect();
          }}
        >
          {found.header ? (
            <Notice kind="ok">
              {found.header.mode === "plain"
                ? t("This folder already holds amphi data, in readable files.", "Ce dossier contient déjà des données amphi, en fichiers lisibles.", "Dieser Ordner enthält bereits amphi-Daten, als lesbare Dateien.")
                : t("This folder already holds amphi data, end-to-end encrypted. Type its passphrase.", "Ce dossier contient déjà des données amphi, chiffrées de bout en bout. Tapez sa phrase de passe.", "Dieser Ordner enthält bereits amphi-Daten, Ende-zu-Ende-verschlüsselt. Geben Sie die Passphrase ein.")}
            </Notice>
          ) : (
            <>
              <Notice kind="ok">{t("The token works. amphi has not written here yet: choose how to store your data.", "Le jeton fonctionne. amphi n'a encore rien écrit ici : choisissez comment stocker vos données.", "Das Token funktioniert. amphi hat hier noch nichts geschrieben: Wählen Sie, wie Ihre Daten gespeichert werden.")}</Notice>
              <Segmented
                label={t("How to store", "Comment stocker", "Speicherart")}
                value={mode}
                onChange={setMode}
                options={[
                  { id: "plain", label: modeLabel(t, "plain") },
                  { id: "encrypted", label: modeLabel(t, "encrypted") },
                ]}
              />
              <p className="meta">
                {mode === "plain"
                  ? t("Folders and Markdown you can read on GitHub. Anyone with access to the repository can read them.", "Des dossiers et du Markdown lisibles sur GitHub. Quiconque a accès au dépôt peut les lire.", "Ordner und Markdown, auf GitHub lesbar. Wer Zugriff auf das Repository hat, kann sie lesen.")
                  : t("GitHub sees only opaque files. The passphrase is needed on each device and cannot be recovered.", "GitHub ne voit que des fichiers opaques. La phrase de passe est demandée sur chaque appareil et ne peut pas être récupérée.", "GitHub sieht nur undurchsichtige Dateien. Die Passphrase wird auf jedem Gerät gebraucht und kann nicht wiederhergestellt werden.")}
              </p>
            </>
          )}
          {(found.header?.mode ?? mode) === "encrypted" ? (
            <>
              <Field label={t("Passphrase", "Phrase de passe", "Passphrase")} hint={found.header ? undefined : t("At least 12 characters.", "Au moins 12 caractères.", "Mindestens 12 Zeichen.")}>
                <input type="password" autoComplete={found.header ? "current-password" : "new-password"} required value={pass} onChange={(e) => setPass(e.currentTarget.value)} />
              </Field>
              {found.header ? null : (
                <Field label={t("Passphrase again", "Phrase de passe, encore", "Passphrase wiederholen")}>
                  <input type="password" autoComplete="new-password" required value={again} onChange={(e) => setAgain(e.currentTarget.value)} />
                </Field>
              )}
            </>
          ) : null}
          <div className="row">
            <button type="submit" className="primary" disabled={busy}>
              {busy ? t("Connecting…", "Connexion…", "Verbinden…") : t("Connect and sync", "Connecter et synchroniser", "Verbinden und synchronisieren")}
            </button>
            <button type="button" className="link" onClick={() => setFound(null)}>
              {t("Back", "Retour", "Zurück")}
            </button>
          </div>
        </form>
      )}
      {problem ? <Notice kind="error">{problem}</Notice> : null}
    </div>
  );
}

function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

function Connected({ s, config }: { s: SyncStatus; config: SyncConfig }) {
  const { t, lang } = useLang();
  const now = useNow();
  const [token, setToken] = useState("");
  const [note, setNote] = useState("");
  const state = s.running
    ? t("Syncing…", "Synchronisation…", "Synchronisierung…")
    : s.at
      ? t(`Synced ${relative(s.at, now, lang)}.`, `Synchronisé ${relative(s.at, now, lang)}.`, `Synchronisiert ${relative(s.at, now, lang)}.`)
      : t("Not synced yet.", "Pas encore synchronisé.", "Noch nicht synchronisiert.");
  const waiting = s.pending > 0 && !s.running ? count(s.pending, ["change waiting", "changes waiting"], ["modification en attente", "modifications en attente"], ["Änderung wartet", "Änderungen warten"], lang) : "";
  const update = (patch: Partial<SyncConfig>) => void saveConfig({ ...config, ...patch });
  return (
    <div className="stack">
      <dl className="facts">
        <dt>{t("Repository", "Dépôt", "Repository")}</dt>
        <dd>
          <a href={`https://github.com/${config.owner}/${config.repo}`} target="_blank" rel="noopener noreferrer">
            {config.owner}/{config.repo}
          </a>
          {config.branch ? ` · ${config.branch}` : ""}
          {config.folder ? ` · ${config.folder}/` : ""}
        </dd>
        <dt>{t("Stored as", "Stocké en", "Gespeichert als")}</dt>
        <dd>{modeLabel(t, s.mode ?? config.mode)}</dd>
      </dl>
      <p className="meta" role="status">
        {state}
        {waiting ? ` ${waiting}.` : ""}
      </p>
      {s.error && !s.running ? <Notice kind="error">{errorText(t, s.error)}</Notice> : null}
      {s.skipped?.length ? (
        <Notice>
          {t(
            `${s.skipped.length} file(s) over 95 MB (${bytes(s.skipped.reduce((a, b) => a + b.size, 0), lang)}) stay on this device only: GitHub refuses files that large. Keep them with a zip or a folder.`,
            `${s.skipped.length} fichier(s) de plus de 95 Mo (${bytes(s.skipped.reduce((a, b) => a + b.size, 0), lang)}) restent sur cet appareil seulement : GitHub refuse des fichiers aussi gros. Gardez-les avec un zip ou un dossier.`,
            `${s.skipped.length} Datei(en) über 95 MB (${bytes(s.skipped.reduce((a, b) => a + b.size, 0), lang)}) bleiben nur auf diesem Gerät: GitHub lehnt so große Dateien ab. Sichern Sie sie per ZIP oder Ordner.`,
          )}
        </Notice>
      ) : null}
      <div className="row">
        <button type="button" className="primary" disabled={s.running} onClick={() => void syncNow()}>
          {t("Sync now", "Synchroniser", "Jetzt synchronisieren")}
        </button>
      </div>
      <label className="check">
        <input type="checkbox" checked={config.auto} onChange={(e) => update({ auto: e.currentTarget.checked })} />
        {t("Sync automatically: on opening, after changes, when leaving", "Synchroniser automatiquement : à l'ouverture, après des modifications, en quittant", "Automatisch synchronisieren: beim Öffnen, nach Änderungen, beim Verlassen")}
      </label>
      <label className="check">
        <input type="checkbox" checked={config.media} onChange={(e) => update({ media: e.currentTarget.checked })} />
        {t("Sync files too (PDF, audio, video)", "Synchroniser aussi les fichiers (PDF, audio, vidéo)", "Auch Dateien synchronisieren (PDF, Audio, Video)")}
      </label>
      <details>
        <summary>{t("Replace the token", "Remplacer le jeton", "Token ersetzen")}</summary>
        <form
          className="row"
          onSubmit={async (e) => {
            e.preventDefault();
            await setSecret(TOKEN_SECRET, token.trim());
            setToken("");
            setNote(t("Token replaced.", "Jeton remplacé.", "Token ersetzt."));
            await syncNow();
          }}
        >
          <Field label={t("New token", "Nouveau jeton", "Neues Token")}>
            <input type="password" autoComplete="off" spellCheck={false} required value={token} onChange={(e) => setToken(e.currentTarget.value)} />
          </Field>
          <button type="submit" className="secondary">
            {t("Save", "Enregistrer", "Speichern")}
          </button>
        </form>
        {note ? <p className="meta">{note}</p> : null}
      </details>
      <div className="row">
        <button
          type="button"
          className="link"
          onClick={async () => {
            await deleteSecret(TOKEN_SECRET);
            await deleteSecret(PASSPHRASE_SECRET);
            await saveConfig(null);
          }}
        >
          {t("Disconnect", "Déconnecter", "Trennen")}
        </button>
        <span className="meta">{t("Your data stays on this device and in the repository.", "Vos données restent sur cet appareil et dans le dépôt.", "Ihre Daten bleiben auf diesem Gerät und im Repository.")}</span>
      </div>
    </div>
  );
}

function importSummary(t: T, r: { records: number; files: number; problems: string[] }): string {
  const base = t(`Imported: ${r.records} record(s), ${r.files} file(s).`, `Importé : ${r.records} élément(s), ${r.files} fichier(s).`, `Importiert: ${r.records} Einträge, ${r.files} Datei(en).`);
  return r.problems.length ? `${base} ${t(`${r.problems.length} entries could not be read and were left out.`, `${r.problems.length} entrées illisibles ont été ignorées.`, `${r.problems.length} unlesbare Einträge wurden ausgelassen.`)}` : base;
}

function LocalFolder() {
  const { t } = useLang();
  const [dir, setDir] = useState<FileSystemDirectoryHandle | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const supported = typeof window !== "undefined" && "showDirectoryPicker" in window;
  useEffect(() => {
    if (supported) void getMeta<FileSystemDirectoryHandle>(FOLDER_KEY).then((d) => setDir(d ?? null));
  }, [supported]);
  if (!supported) {
    return (
      <p className="meta">
        {t(
          "Mirroring to a folder needs a browser that lets sites write to a folder you pick (Chrome, Edge, Opera). In this one, use the zip backup below.",
          "Le miroir dans un dossier demande un navigateur qui laisse un site écrire dans un dossier choisi (Chrome, Edge, Opera). Dans celui-ci, utilisez la sauvegarde zip ci-dessous.",
          "Das Spiegeln in einen Ordner braucht einen Browser, der Websites in einen gewählten Ordner schreiben lässt (Chrome, Edge, Opera). Hier nutzen Sie die ZIP-Sicherung unten.",
        )}
      </p>
    );
  }
  const run = async (fn: (local: typeof import("./local.ts"), store: typeof import("./store.ts")["dbStore"], d: FileSystemDirectoryHandle) => Promise<string>) => {
    if (!dir) return;
    setBusy(true);
    setMsg(null);
    try {
      const [local, { dbStore }] = await Promise.all([import("./local.ts"), import("./store.ts")]);
      if (!(await local.allowed(dir))) throw new Error(t("Access to the folder was not allowed.", "L'accès au dossier n'a pas été autorisé.", "Der Zugriff auf den Ordner wurde nicht erlaubt."));
      setMsg({ kind: "ok", text: await fn(local, dbStore, dir) });
    } catch (e) {
      setMsg({ kind: "error", text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="stack">
      <p className="meta">
        {t(
          "The same readable files as on GitHub, in a folder of your choice (a synced drive works too).",
          "Les mêmes fichiers lisibles que sur GitHub, dans un dossier de votre choix (un disque synchronisé convient aussi).",
          "Dieselben lesbaren Dateien wie auf GitHub, in einem Ordner Ihrer Wahl (auch ein synchronisiertes Laufwerk).",
        )}
      </p>
      <div className="row">
        <button
          type="button"
          className="secondary"
          onClick={async () => {
            try {
              const { pickFolder } = await import("./local.ts");
              const d = await pickFolder();
              await setMeta(FOLDER_KEY, d);
              setDir(d);
            } catch {}
          }}
        >
          {dir ? t("Choose another folder", "Choisir un autre dossier", "Anderen Ordner wählen") : t("Choose a folder", "Choisir un dossier", "Ordner wählen")}
        </button>
        {dir ? <span className="meta">{dir.name}</span> : null}
      </div>
      {dir ? (
        <div className="row">
          <button
            type="button"
            className="primary"
            disabled={busy}
            onClick={() =>
              void run(async (local, store, d) => {
                const r = await local.writeFolder(store, d);
                return t(`Folder updated: ${r.written} file(s) written, ${r.removed} removed.`, `Dossier à jour : ${r.written} fichier(s) écrit(s), ${r.removed} supprimé(s).`, `Ordner aktualisiert: ${r.written} Datei(en) geschrieben, ${r.removed} entfernt.`);
              })
            }
          >
            {t("Write to the folder", "Écrire dans le dossier", "In den Ordner schreiben")}
          </button>
          <button type="button" className="secondary" disabled={busy} onClick={() => void run(async (local, store, d) => importSummary(t, await local.readFolder(store, d)))}>
            {t("Read from the folder", "Lire depuis le dossier", "Aus dem Ordner lesen")}
          </button>
        </div>
      ) : null}
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
    </div>
  );
}

function ZipBackup() {
  const { t } = useLang();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  return (
    <div className="stack">
      <p className="meta">
        {t(
          "Everything in one file, in the same readable layout, to keep or to open in amphi on another browser. Importing keeps the newer version of each item.",
          "Tout dans un seul fichier, dans la même disposition lisible, à garder ou à ouvrir dans amphi sur un autre navigateur. L'import garde la version la plus récente de chaque élément.",
          "Alles in einer Datei, im selben lesbaren Aufbau, zum Aufbewahren oder zum Öffnen in amphi in einem anderen Browser. Beim Import bleibt die neuere Version jedes Eintrags.",
        )}
      </p>
      <div className="row">
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const [{ exportZip }, { dbStore }] = await Promise.all([import("./local.ts"), import("./store.ts")]);
              saveFile(await exportZip(dbStore), `amphi-${new Date().toISOString().slice(0, 10)}.zip`);
            } finally {
              setBusy(false);
            }
          }}
        >
          {t("Export a zip", "Exporter un zip", "ZIP exportieren")}
        </button>
        <button type="button" className="secondary" disabled={busy} onClick={() => input.current?.click()}>
          {t("Import a zip", "Importer un zip", "ZIP importieren")}
        </button>
        <input
          ref={input}
          type="file"
          accept=".zip,application/zip"
          hidden
          aria-label={t("Zip to import", "Zip à importer", "ZIP zum Importieren")}
          onChange={async (e) => {
            const file = e.currentTarget.files?.[0];
            e.currentTarget.value = "";
            if (!file) return;
            setBusy(true);
            setMsg(null);
            try {
              const [{ importZip }, { dbStore }] = await Promise.all([import("./local.ts"), import("./store.ts")]);
              setMsg({ kind: "ok", text: importSummary(t, await importZip(dbStore, file)) });
            } catch (err) {
              setMsg({ kind: "error", text: (err as Error).message });
            } finally {
              setBusy(false);
            }
          }}
        />
      </div>
      {msg ? <Notice kind={msg.kind}>{msg.text}</Notice> : null}
    </div>
  );
}
