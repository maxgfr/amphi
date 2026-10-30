// Settings: the AI provider, how keys are protected, sync, this device's
// storage, and what leaves the device.

import { ENDPOINT_PRESETS } from "llm-connect";
import { useLlmSettings } from "llm-connect/react";
import { lazy, Suspense, useEffect, useState } from "react";
import { llm, loadLlm, reloadLlm } from "../ai/llm.ts";
import { persist } from "../data/db.ts";
import { bytes, useLang } from "../i18n.ts";
import { useOfflineReady } from "../pwa.ts";
import { go, href } from "../router.ts";
import { protectWithPassphrase, removePassphrase, vaultMode } from "../secrets.ts";
import { Field, Notice, Tabs } from "../ui/kit.tsx";

const SyncSettings = lazy(() => import("../sync/settings.tsx").then((m) => ({ default: m.SyncSettings })));
const VoiceSettings = lazy(() => import("../voice/settings.tsx").then((m) => ({ default: m.VoiceSettings })));

type Section = "ai" | "voice" | "sync" | "security" | "device" | "privacy";

export function Settings({ section }: { section?: string }) {
  const { t } = useLang();
  const current: Section = (["ai", "voice", "sync", "security", "device", "privacy"] as const).includes(section as Section) ? (section as Section) : "ai";
  return (
    <div className="page narrow">
      <header className="divider">
        <h1>{t("Settings", "Réglages", "Einstellungen")}</h1>
        <Tabs
          tabs={[
            { id: "ai", label: t("AI", "IA", "KI"), icon: "sparkle" },
            { id: "voice", label: t("Voices", "Voix", "Stimmen"), icon: "headphones" },
            { id: "sync", label: t("Sync", "Synchro", "Sync"), icon: "cloud" },
            { id: "security", label: t("Keys", "Clés", "Schlüssel"), icon: "lock" },
            { id: "device", label: t("This device", "Cet appareil", "Dieses Gerät"), icon: "folder" },
            { id: "privacy", label: t("Privacy", "Confidentialité", "Datenschutz"), icon: "globe" },
          ]}
          value={current}
          onChange={(k) => go(href.settings(k))}
          label={t("Settings sections", "Sections des réglages", "Bereiche der Einstellungen")}
        />
      </header>
      <div className="tab-panel" role="tabpanel">
        {current === "ai" ? <AiSettings /> : null}
        <Suspense fallback={<div aria-busy="true" />}>
          {current === "voice" ? <VoiceSettings /> : null}
          {current === "sync" ? <SyncSettings /> : null}
        </Suspense>
        {current === "security" ? <KeySettings /> : null}
        {current === "device" ? <DeviceSettings /> : null}
        {current === "privacy" ? <Privacy /> : null}
      </div>
    </div>
  );
}

function AiSettings() {
  const { t } = useLang();
  const s = useLlmSettings(llm);
  const [status, setStatus] = useState("");
  // open() replaces the draft with the saved settings: the form shows only after it, so no early edit is lost.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    void loadLlm().then(() => {
      llm.open();
      setReady(true);
    });
  }, []);
  if (!ready) return <div aria-busy="true" />;
  const providers = [...s.providers.recommended, ...s.providers.others];
  const custom = s.draft.custom;
  return (
    <div className="stack">
      <p className="lead">
        {t(
          "amphi calls your own AI provider straight from this browser, with your key. Only what you ask for is sent; the key is encrypted on this device.",
          "amphi appelle votre propre fournisseur d'IA directement depuis ce navigateur, avec votre clé. Seul ce que vous demandez est envoyé ; la clé est chiffrée sur cet appareil.",
          "amphi ruft Ihren eigenen KI-Anbieter direkt aus diesem Browser mit Ihrem Schlüssel auf. Nur was Sie anfordern, wird gesendet; der Schlüssel ist auf diesem Gerät verschlüsselt.",
        )}
      </p>
      <div className="segmented wide" role="group" aria-label={t("Kind of provider", "Type de fournisseur", "Art des Anbieters")}>
        <button type="button" aria-pressed={!custom} onClick={() => llm.toggleCustom(false)}>
          {t("Online provider", "Fournisseur en ligne", "Online-Anbieter")}
        </button>
        <button type="button" aria-pressed={custom} onClick={() => llm.toggleCustom(true)}>
          {t("On my machine", "Sur ma machine", "Auf meinem Rechner")}
        </button>
      </div>
      {custom ? (
        <>
          <div className="row">
            {Object.values(ENDPOINT_PRESETS).map((p) => (
              <button key={p.id} type="button" className="secondary small" onClick={() => llm.applyPreset(p)}>
                {p.name}
              </button>
            ))}
          </div>
          <Field label={t("Server address", "Adresse du serveur", "Serveradresse")}>
            <input type="url" spellCheck={false} value={s.draft.customEndpoint} placeholder="http://localhost:11434/v1" onChange={(e) => llm.setEndpoint(e.currentTarget.value)} />
          </Field>
          <Field label={t("Model", "Modèle", "Modell")}>
            <input type="text" spellCheck={false} value={s.draft.customModel} onChange={(e) => llm.setCustomModel(e.currentTarget.value)} />
          </Field>
          <p className="meta">{t("Ollama must allow this site: OLLAMA_ORIGINS=https://maxgfr.github.io ollama serve", "Ollama doit autoriser ce site : OLLAMA_ORIGINS=https://maxgfr.github.io ollama serve", "Ollama muss diese Seite erlauben: OLLAMA_ORIGINS=https://maxgfr.github.io ollama serve")}</p>
        </>
      ) : (
        <>
          <Field label={t("Provider", "Fournisseur", "Anbieter")}>
            <select value={s.draft.providerId} onChange={(e) => llm.selectProvider(e.currentTarget.value)}>
              <option value="">{t("Choose…", "Choisir…", "Auswählen…")}</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          {s.provider ? (
            <Field label={t("Model", "Modèle", "Modell")}>
              <select value={s.draft.model} onChange={(e) => llm.selectModel(e.currentTarget.value)}>
                {s.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name ?? m.id}
                    {s.recommendedModel?.id === m.id ? ` · ${t("recommended", "recommandé", "empfohlen")}` : ""}
                  </option>
                ))}
              </select>
            </Field>
          ) : null}
        </>
      )}
      <Field label={custom ? t("API key (often none)", "Clé d'API (souvent aucune)", "API-Schlüssel (oft keiner)") : t("API key", "Clé d'API", "API-Schlüssel")}>
        <input type="password" autoComplete="off" spellCheck={false} value={s.apiKey} onChange={(e) => llm.setApiKey(e.currentTarget.value)} />
      </Field>
      <label className="check">
        <input type="checkbox" checked={s.draft.rememberKey} onChange={(e) => llm.setRememberKey(e.currentTarget.checked)} />
        {t("Remember the key on this device (encrypted)", "Retenir la clé sur cet appareil (chiffrée)", "Schlüssel auf diesem Gerät merken (verschlüsselt)")}
      </label>
      <div className="row">
        <button
          type="button"
          className="secondary"
          disabled={!s.canTest || s.testing}
          onClick={async () => {
            const r = await llm.test();
            setStatus(r.ok ? t("The connection works.", "La connexion fonctionne.", "Die Verbindung funktioniert.") : t(`Connection failed: ${r.message ?? r.reason}`, `Échec de la connexion : ${r.message ?? r.reason}`, `Verbindung fehlgeschlagen: ${r.message ?? r.reason}`));
          }}
        >
          {s.testing ? t("Testing…", "Test…", "Test…") : t("Test", "Tester", "Testen")}
        </button>
        <button
          type="button"
          className="primary"
          disabled={!s.canSave}
          onClick={async () => {
            const r = await llm.save();
            setStatus(
              r.ok
                ? t("Saved.", "Enregistré.", "Gespeichert.")
                : r.reason === "insecure-endpoint"
                  ? t("Use https, or http only on this machine (localhost).", "Utilisez https, ou http seulement sur cette machine (localhost).", "Verwenden Sie https oder http nur auf diesem Rechner (localhost).")
                  : t("Some settings are missing or invalid.", "Des réglages manquent ou sont invalides.", "Einige Einstellungen fehlen oder sind ungültig."),
            );
          }}
        >
          {t("Save", "Enregistrer", "Speichern")}
        </button>
        {s.saved ? (
          <button type="button" className="link" onClick={() => void llm.clear().then(() => setStatus(t("Removed.", "Supprimé.", "Entfernt.")))}>
            {t("Forget this provider", "Oublier ce fournisseur", "Diesen Anbieter vergessen")}
          </button>
        ) : null}
      </div>
      <p className="meta" role="status">
        {status}
      </p>
      {s.catalogStatus === "error" ? <Notice kind="error">{t("The model list could not load.", "La liste des modèles n'a pas pu se charger.", "Die Modellliste konnte nicht geladen werden.")}</Notice> : null}
    </div>
  );
}

function KeySettings() {
  const { t } = useLang();
  const mode = vaultMode();
  const [pass, setPass] = useState("");
  const [again, setAgain] = useState("");
  const [status, setStatus] = useState("");
  return (
    <div className="stack">
      <p className="lead">
        {mode === "device"
          ? t(
              "Your keys and token are encrypted on this device and open without a prompt. With a passphrase, they open only when you type it and lock after 15 idle minutes.",
              "Vos clés et votre jeton sont chiffrés sur cet appareil et s'ouvrent sans invite. Avec une phrase de passe, ils ne s'ouvrent que quand vous la tapez et se verrouillent après 15 minutes d'inactivité.",
              "Ihre Schlüssel und Ihr Token sind auf diesem Gerät verschlüsselt und öffnen sich ohne Abfrage. Mit einer Passphrase öffnen sie sich nur nach Eingabe und sperren sich nach 15 Minuten Inaktivität.",
            )
          : t("Your keys and token open only with your passphrase.", "Vos clés et votre jeton ne s'ouvrent qu'avec votre phrase de passe.", "Ihre Schlüssel und Ihr Token öffnen sich nur mit Ihrer Passphrase.")}
      </p>
      {mode === "device" ? (
        <form
          className="stack"
          onSubmit={async (e) => {
            e.preventDefault();
            if (pass !== again) return setStatus(t("The two passphrases differ.", "Les deux phrases de passe diffèrent.", "Die beiden Passphrasen unterscheiden sich."));
            await protectWithPassphrase(pass);
            location.reload();
          }}
        >
          <Field label={t("New passphrase", "Nouvelle phrase de passe", "Neue Passphrase")} hint={t("At least 12 characters. It cannot be recovered.", "Au moins 12 caractères. Elle ne peut pas être récupérée.", "Mindestens 12 Zeichen. Sie kann nicht wiederhergestellt werden.")}>
            <input type="password" autoComplete="new-password" minLength={12} required value={pass} onChange={(e) => setPass(e.currentTarget.value)} />
          </Field>
          <Field label={t("Again", "Encore", "Wiederholen")}>
            <input type="password" autoComplete="new-password" minLength={12} required value={again} onChange={(e) => setAgain(e.currentTarget.value)} />
          </Field>
          <div className="row">
            <button type="submit" className="primary">
              {t("Protect with a passphrase", "Protéger par une phrase de passe", "Mit einer Passphrase schützen")}
            </button>
          </div>
        </form>
      ) : (
        <div className="row">
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              await removePassphrase();
              location.reload();
            }}
          >
            {t("Open without a passphrase on this device", "Ouvrir sans phrase de passe sur cet appareil", "Auf diesem Gerät ohne Passphrase öffnen")}
          </button>
          <button
            type="button"
            className="secondary"
            onClick={async () => {
              const { vault } = await import("../secrets.ts");
              vault.lock();
              await reloadLlm();
            }}
          >
            {t("Lock now", "Verrouiller maintenant", "Jetzt sperren")}
          </button>
        </div>
      )}
      <p className="meta" role="status">
        {status}
      </p>
    </div>
  );
}

function DeviceSettings() {
  const { t } = useLang();
  const offline = useOfflineReady();
  const [info, setInfo] = useState<{ persisted: boolean; usage?: number; quota?: number } | null>(null);
  useEffect(() => {
    void (async () => {
      const persisted = await persist();
      const est = await navigator.storage?.estimate?.().catch(() => undefined);
      setInfo({ persisted, usage: est?.usage, quota: est?.quota });
    })();
  }, []);
  if (!info) return <div aria-busy="true" />;
  return (
    <div className="stack">
      <p className="lead">{t("Your courses live in this browser's storage. Sync copies them to your own repository.", "Vos cours vivent dans le stockage de ce navigateur. La synchro les copie dans votre propre dépôt.", "Ihre Kurse liegen im Speicher dieses Browsers. Die Synchronisierung kopiert sie in Ihr eigenes Repository.")}</p>
      <dl className="facts">
        <dt>{t("Used", "Utilisé", "Belegt")}</dt>
        <dd>{info.usage !== undefined ? bytes(info.usage) : "—"}</dd>
        <dt>{t("Available", "Disponible", "Verfügbar")}</dt>
        <dd>{info.quota !== undefined ? bytes(info.quota) : "—"}</dd>
        <dt>{t("Protected from eviction", "Protégé de l'effacement", "Vor Löschung geschützt")}</dt>
        <dd>{info.persisted ? t("Yes", "Oui", "Ja") : t("No: the browser may clear it when space runs out. Sync keeps a copy.", "Non : le navigateur peut l'effacer s'il manque de place. La synchro garde une copie.", "Nein: Der Browser kann ihn bei Platzmangel löschen. Die Synchronisierung behält eine Kopie.")}</dd>
        <dt>{t("Works offline", "Fonctionne hors ligne", "Funktioniert offline")}</dt>
        <dd>
          {offline === "ready"
            ? t("Yes: the app is on this device. AI, Discover and sync wait for a connection.", "Oui : l'application est sur cet appareil. L'IA, Découvrir et la synchro attendent une connexion.", "Ja: Die App liegt auf diesem Gerät. KI, Entdecken und Synchronisierung warten auf eine Verbindung.")
            : offline === "preparing"
              ? t("Getting ready…", "En préparation…", "Wird vorbereitet…")
              : t("No: this browser cannot keep the app.", "Non : ce navigateur ne peut pas garder l'application.", "Nein: Dieser Browser kann die App nicht speichern.")}
        </dd>
      </dl>
    </div>
  );
}

function Privacy() {
  const { t } = useLang();
  return (
    <div className="prose">
      <p>{t("amphi has no server and no account. Everything stays in this browser until you send it somewhere yourself:", "amphi n'a ni serveur ni compte. Tout reste dans ce navigateur jusqu'à ce que vous l'envoyiez vous-même quelque part :", "amphi hat weder Server noch Konto. Alles bleibt in diesem Browser, bis Sie es selbst irgendwohin senden:")}</p>
      <ul>
        <li>{t("to your AI provider, the text of the sources you pick, when you ask for something (the screen says which provider);", "à votre fournisseur d'IA, le texte des sources choisies, quand vous demandez quelque chose (l'écran dit à quel fournisseur) ;", "an Ihren KI-Anbieter den Text der gewählten Quellen, wenn Sie etwas anfordern (der Bildschirm nennt den Anbieter);")}</li>
        <li>{t("to your provider's transcription or voice model, the audio or the script, only if you pick it over the models that run on this device;", "au modèle de transcription ou de voix de votre fournisseur, l'audio ou le script, seulement si vous le préférez aux modèles qui tournent sur cet appareil ;", "an das Transkriptions- oder Sprachmodell Ihres Anbieters Audio oder Skript, nur wenn Sie es den Modellen auf diesem Gerät vorziehen;")}</li>
        <li>{t("to your GitHub repository, your data, if you turn sync on (in clear or end-to-end encrypted, your choice);", "à votre dépôt GitHub, vos données, si vous activez la synchro (en clair ou chiffrées de bout en bout, au choix) ;", "an Ihr GitHub-Repository Ihre Daten, wenn Sie die Synchronisierung einschalten (unverschlüsselt oder Ende-zu-Ende-verschlüsselt, nach Wahl);")}</li>
        <li>{t("from Hugging Face, the speech and voice models, downloaded once after you see their size.", "depuis Hugging Face, les modèles de parole et de voix, téléchargés une fois après avoir vu leur taille.", "von Hugging Face die Sprach- und Stimmmodelle, einmalig heruntergeladen, nachdem Sie ihre Größe gesehen haben.")}</li>
      </ul>
      <p>{t("The page's security policy blocks every other address, and no analytics or third-party script is loaded.", "La politique de sécurité de la page bloque toute autre adresse, et aucun script de mesure ou tiers n'est chargé.", "Die Sicherheitsrichtlinie der Seite blockiert jede andere Adresse, und es werden keine Analyse- oder Drittanbieter-Skripte geladen.")}</p>
      <p>
        <a href="https://github.com/maxgfr/amphi" target="_blank" rel="noopener noreferrer">
          {t("Source code", "Code source", "Quellcode")}
        </a>
      </p>
    </div>
  );
}
