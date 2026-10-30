// Transcription of a recording or an imported audio or video file: choose the
// engine (a model on this device, downloaded once, or the user's provider,
// told what is sent and to whom first) and the spoken language, then follow
// the download and the transcription, or cancel.

import { useEffect, useState, useSyncExternalStore } from "react";
import { llm, loadLlm } from "../ai/llm.ts";
import { get } from "../data/db.ts";
import { useLive } from "../data/hooks.ts";
import type { Source } from "../data/schema.ts";
import { bytes, clock, languageLabel, type T, useLang } from "../i18n.ts";
import { href } from "../router.ts";
import { Icon } from "../ui/icons.tsx";
import { Field, Notice, ProgressBar } from "../ui/kit.tsx";
import { cloudTarget, uploadsFor } from "./cloud.ts";
import { cacheKey, cachedEngines, defaultLanguage, ENGINE_IDS, type Engine, type EngineId, engineLabel, engineProblem, engineSize, isEngineId, LANGUAGES, resolveEngine } from "./engines.ts";
import { cancelTranscription, type Stage, startTranscription, useStage } from "./run.ts";

const ENGINE_KEY = "amphi-stt-engine";
const MODEL_KEY = "amphi-stt-model";

function remembered<V extends string>(key: string, valid: (v: unknown) => v is V, fallback: V): V {
  try {
    const v = localStorage.getItem(key);
    return valid(v) ? v : fallback;
  } catch {
    return fallback;
  }
}
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function engineName(id: EngineId, t: T): string {
  switch (id) {
    case "auto":
      return t("Automatic: the best model for the language", "Automatique : le meilleur modèle pour la langue", "Automatisch: das beste Modell für die Sprache");
    case "parakeet":
      return "Parakeet TDT 0.6B v3";
    case "canary":
      return "Canary 180M Flash";
    case "whisper-fast":
      return t("Whisper base (fast)", "Whisper base (rapide)", "Whisper base (schnell)");
    case "whisper-balanced":
      return t("Whisper small (balanced)", "Whisper small (équilibré)", "Whisper small (ausgewogen)");
    case "whisper-accurate":
      return t("Whisper large v3 turbo (accurate)", "Whisper large v3 turbo (précis)", "Whisper large v3 turbo (genau)");
    case "cloud":
      return t("Your AI provider (sends the audio)", "Votre fournisseur d'IA (envoie l'audio)", "Ihr KI-Anbieter (sendet den Ton)");
  }
}

function useLlmState() {
  return useSyncExternalStore(
    (fn) => llm.subscribe(fn),
    () => llm.getState().saved,
  );
}

export function TranscribePanel({ source }: { source: Source }) {
  const stage = useStage(source.id);
  return (
    <section className="transcribe" aria-label={useLang().t("Transcription", "Transcription", "Transkription")}>
      {stage ? <Progress source={source} stage={stage} /> : <Setup key={source.id} source={source} />}
    </section>
  );
}

function Setup({ source }: { source: Source }) {
  const { t, lang } = useLang();
  const course = useLive(() => get("courses", source.courseId), ["courses"], [source.courseId]);
  const [engineId, setEngineId] = useState<EngineId>(() => remembered(ENGINE_KEY, isEngineId, "auto"));
  const [picked, setPicked] = useState<string | null>(null);
  const [model, setModel] = useState(() => remembered(MODEL_KEY, (v): v is string => typeof v === "string", ""));
  const [cached, setCached] = useState<Set<string>>(new Set());
  useLlmState();
  useEffect(() => {
    void loadLlm();
    void cachedEngines().then(setCached);
  }, []);

  const language = picked ?? defaultLanguage(course?.language);
  const engine = resolveEngine(engineId, language);
  const problem = engineProblem(engine, language);
  // A model name only for servers that need one (a remembered name must not reach another provider).
  const needsModel = engine.kind === "cloud" && cloudTarget().needsModel;
  const usedModel = needsModel ? model.trim() || undefined : undefined;
  const cloud = engine.kind === "cloud" ? cloudTarget(usedModel) : null;
  const blocked = problem === "canary-language" || Boolean(cloud?.problem);
  const interrupted = source.status === "transcribing";
  const what = source.kind === "recording" ? t("this recording", "cet enregistrement", "diese Aufnahme") : t("this file's audio", "l'audio de ce fichier", "der Ton dieser Datei");

  return (
    <form
      className="stack transcribe-box"
      onSubmit={(e) => {
        e.preventDefault();
        if (blocked) return;
        remember(ENGINE_KEY, engineId);
        if (usedModel) remember(MODEL_KEY, usedModel);
        startTranscription(source, { engine, language, model: usedModel });
      }}
    >
      <h2 className="section-title">{t("Transcribe", "Transcrire", "Transkribieren")}</h2>
      {interrupted ? (
        <Notice>{t("The transcription was interrupted when the page closed. Start it again.", "La transcription a été interrompue à la fermeture de la page. Relancez-la.", "Die Transkription wurde beim Schließen der Seite unterbrochen. Starten Sie sie erneut.")}</Notice>
      ) : null}
      <div className="row">
        <Field label={t("Engine", "Moteur", "Modell")}>
          <select value={engineId} onChange={(e) => setEngineId(e.currentTarget.value as EngineId)}>
            <optgroup label={t("On this device", "Sur cet appareil", "Auf diesem Gerät")}>
              {ENGINE_IDS.filter((id) => id !== "cloud").map((id) => {
                const e = resolveEngine(id, language);
                const size = id === "auto" ? "" : cached.has(cacheKey(e)) ? t(" · downloaded", " · téléchargé", " · heruntergeladen") : ` · ${bytes(engineSize(e) * 1e6, lang)}`;
                return (
                  <option key={id} value={id}>
                    {engineName(id, t)}
                    {size}
                  </option>
                );
              })}
            </optgroup>
            <optgroup label={t("Online", "En ligne", "Online")}>
              <option value="cloud">{engineName("cloud", t)}</option>
            </optgroup>
          </select>
        </Field>
        <Field label={t("Spoken language", "Langue parlée", "Gesprochene Sprache")}>
          <select value={language} onChange={(e) => setPicked(e.currentTarget.value)}>
            {LANGUAGES.map((code) => (
              <option key={code} value={code}>
                {code === "auto" ? t("Detect", "Détecter", "Erkennen") : languageLabel(code, lang)}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <div aria-live="polite">{cloud ? <CloudNotice source={source} cloud={cloud} what={what} needsModel={needsModel} model={model} setModel={setModel} /> : <LocalNotice engine={engine} language={language} cached={cached.has(cacheKey(engine))} problem={problem} />}</div>
      <div className="row">
        <button type="submit" className="primary" disabled={blocked}>
          <Icon name={cloud ? "send" : "sparkle"} size={18} /> {cloud ? t("Send and transcribe", "Envoyer et transcrire", "Senden und transkribieren") : t("Transcribe on this device", "Transcrire sur cet appareil", "Auf diesem Gerät transkribieren")}
        </button>
      </div>
    </form>
  );
}

function LocalNotice({ engine, language, cached, problem }: { engine: Engine; language: string; cached: boolean; problem: ReturnType<typeof engineProblem> }) {
  const { t, lang } = useLang();
  const size = bytes(engineSize(engine) * 1e6, lang);
  return (
    <p className="meta">
      <strong>{engineLabel(engine)}</strong> ·{" "}
      {cached ? t("already on this device", "déjà sur cet appareil", "bereits auf diesem Gerät") : t(`${size} to download once, then kept by the browser`, `${size} à télécharger une fois, puis gardés par le navigateur`, `${size} einmal herunterzuladen, danach vom Browser behalten`)} ·{" "}
      {t("runs here: the audio never leaves this device.", "tourne ici : l'audio ne quitte jamais cet appareil.", "läuft hier: Der Ton verlässt dieses Gerät nie.")}
      {engine.kind === "nemo" && engine.model === "parakeet" && language === "auto"
        ? ` ${t("Parakeet finds the language itself; if the text comes out in another language, choose the spoken language.", "Parakeet trouve la langue tout seul ; si le texte sort dans une autre langue, choisissez la langue parlée.", "Parakeet erkennt die Sprache selbst; kommt der Text in einer anderen Sprache heraus, wählen Sie die gesprochene Sprache.")}`
        : ""}
      {problem === "whisper-auto"
        ? ` ${t(`Whisper does not detect the language: it will listen for ${languageLabel(navigator.language.slice(0, 2), lang)}.`, `Whisper ne détecte pas la langue : il écoutera du ${languageLabel(navigator.language.slice(0, 2), lang)}.`, `Whisper erkennt die Sprache nicht: Es erwartet ${languageLabel(navigator.language.slice(0, 2), lang)}.`)}`
        : ""}
      {problem === "canary-language" ? (
        <span className="error-text"> {t("Canary needs the spoken language: English, French, German or Spanish.", "Canary a besoin de la langue parlée : anglais, français, allemand ou espagnol.", "Canary braucht die gesprochene Sprache: Englisch, Französisch, Deutsch oder Spanisch.")}</span>
      ) : null}
    </p>
  );
}

function CloudNotice({ source, cloud, what, needsModel, model, setModel }: { source: Source; cloud: ReturnType<typeof cloudTarget>; what: string; needsModel: boolean; model: string; setModel: (m: string) => void }) {
  const { t, lang } = useLang();
  const parts = uploadsFor(source.size ?? 0, source.duration);
  return (
    <div className="stack">
      {needsModel ? (
        <Field label={t("Transcription model", "Modèle de transcription", "Transkriptionsmodell")} hint={t("The speech-to-text model your server serves.", "Le modèle de transcription que sert votre serveur.", "Das Sprache-zu-Text-Modell Ihres Servers.")}>
          <input value={model} spellCheck={false} placeholder="whisper-1" onChange={(e) => setModel(e.currentTarget.value)} />
        </Field>
      ) : null}
      {cloud.problem && !cloud.needsModel ? (
        <Notice kind="error">
          {cloud.problem} {cloud.recipient ? null : <a href={href.settings("ai")}>{t("Set up a provider", "Configurer un fournisseur", "Anbieter einrichten")}</a>}
        </Notice>
      ) : null}
      {cloud.recipient && !cloud.problem ? (
        <Notice>
          {t(
            `The audio of ${what} (${bytes(source.size ?? 0, lang)}${parts > 1 ? `, in ${parts} parts` : ""}) is sent to ${cloud.recipient} and transcribed by ${cloud.model}. Nothing else is sent.`,
            `L'audio de ${what} (${bytes(source.size ?? 0, lang)}${parts > 1 ? `, en ${parts} parties` : ""}) est envoyé à ${cloud.recipient} et transcrit par ${cloud.model}. Rien d'autre n'est envoyé.`,
            `Der Ton von ${what} (${bytes(source.size ?? 0, lang)}${parts > 1 ? `, in ${parts} Teilen` : ""}) wird an ${cloud.recipient} gesendet und von ${cloud.model} transkribiert. Sonst wird nichts gesendet.`,
          )}
        </Notice>
      ) : null}
    </div>
  );
}

function stageText(stage: Stage, t: T, lang: ReturnType<typeof useLang>["lang"]): { status: string; detail?: string; ratio?: number } {
  switch (stage.stage) {
    case "queued":
      return { status: t("Waiting for the transcription before it…", "En attente de la transcription précédente…", "Wartet auf die vorherige Transkription…") };
    case "decode":
      return { status: t("Reading the audio…", "Lecture de l'audio…", "Ton wird gelesen…") };
    case "download":
      return {
        status: t("Downloading the model, once…", "Téléchargement du modèle, une seule fois…", "Modell wird einmalig heruntergeladen…"),
        detail: `${Math.round(stage.ratio * 100)} %${stage.total ? ` · ${bytes(stage.loaded, lang)} / ${bytes(stage.total, lang)}` : ""}`,
        ratio: stage.ratio,
      };
    case "transcribe": {
      const left = stage.ratio && stage.ratio > 0.02 ? (stage.elapsed / stage.ratio) * (1 - stage.ratio) : null;
      return {
        status: t("Transcribing on this device…", "Transcription sur cet appareil…", "Transkription auf diesem Gerät…"),
        detail: [
          stage.ratio !== null ? `${Math.round(stage.ratio * 100)} %` : null,
          t(`${clock(stage.elapsed)} elapsed for ${clock(stage.duration)} of audio`, `${clock(stage.elapsed)} écoulées pour ${clock(stage.duration)} d'audio`, `${clock(stage.elapsed)} vergangen für ${clock(stage.duration)} Ton`),
          left !== null ? t(`about ${clock(left)} left`, `environ ${clock(left)} restantes`, `noch etwa ${clock(left)}`) : null,
        ]
          .filter(Boolean)
          .join(" · "),
        ratio: stage.ratio ?? undefined,
      };
    }
    case "upload":
      return {
        status: t("Sending to your provider and transcribing…", "Envoi à votre fournisseur et transcription…", "Wird an Ihren Anbieter gesendet und transkribiert…"),
        detail: stage.parts > 1 ? t(`part ${Math.min(stage.done + 1, stage.parts)} of ${stage.parts}`, `partie ${Math.min(stage.done + 1, stage.parts)} sur ${stage.parts}`, `Teil ${Math.min(stage.done + 1, stage.parts)} von ${stage.parts}`) : undefined,
        ratio: stage.parts > 1 ? stage.done / stage.parts : undefined,
      };
  }
}

function Progress({ source, stage }: { source: Source; stage: Stage }) {
  const { t, lang } = useLang();
  const { status, detail, ratio } = stageText(stage, t, lang);
  return (
    <div className="stack transcribe-box">
      <p role="status" className="transcribe-status">
        {status}
      </p>
      <ProgressBar ratio={ratio} label={t("Transcription progress", "Progression de la transcription", "Fortschritt der Transkription")} />
      {detail ? <p className="meta">{detail}</p> : null}
      <div className="row">
        <button type="button" className="secondary" onClick={() => cancelTranscription(source.id)}>
          <Icon name="x" size={18} /> {t("Cancel", "Annuler", "Abbrechen")}
        </button>
      </div>
    </div>
  );
}
