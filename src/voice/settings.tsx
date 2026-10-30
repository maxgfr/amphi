// Voices for audio summaries, podcasts and video narration: for English,
// French and German, voices that run on this device (downloaded once, after
// their size is shown) or the provider's speech model; other languages use
// the provider's. Two voices per language for dialogues, and the speed.

import { useEffect, useState } from "react";
import { loadLlm, recipient, savedSettings } from "../ai/llm.ts";
import { bytes, languageLabel, useLang } from "../i18n.ts";
import { Icon } from "../ui/icons.tsx";
import { Field, Notice, ProgressBar, Segmented } from "../ui/kit.tsx";
import { filesFor, totalBytes, VOICE_LANGS, type VoiceLang, voicesOf } from "./catalog.ts";
import { downloadFiles, removeFiles } from "./device.ts";
import { missing, refreshCached, setVoicePrefs, useVoicePrefs, type VoicePrefs } from "./prefs.ts";
import { PROVIDER_VOICES, speechTarget } from "./provider.ts";
import { speak } from "./speak.ts";

const SAMPLE: Record<VoiceLang, [string, string]> = {
  en: ["Welcome back. Today we go through the key ideas of the lesson.", "Great, let's start with the definitions."],
  fr: ["Bonjour à tous. Aujourd'hui, on revoit les idées clés de la leçon.", "Parfait, commençons par les définitions."],
  de: ["Willkommen zurück. Heute gehen wir die wichtigsten Ideen der Lektion durch.", "Gut, fangen wir mit den Definitionen an."],
};

export function VoiceSettings() {
  const { t } = useLang();
  const p = useVoicePrefs();
  const [, setReady] = useState(false);
  useEffect(() => {
    void loadLlm().then(() => setReady(true));
    void refreshCached();
  }, []);
  const set = (patch: Partial<VoicePrefs>) => setVoicePrefs({ ...p, ...patch });
  return (
    <div className="stack">
      <p className="lead">
        {t(
          "Audio summaries and podcasts are read by voices that run on this device, so the script never leaves it, or by your AI provider's voice model. On-device voices download once from Hugging Face.",
          "Les résumés audio et les podcasts sont lus par des voix qui tournent sur cet appareil, le script ne le quitte donc jamais, ou par le modèle de voix de votre fournisseur d'IA. Les voix de l'appareil se téléchargent une fois depuis Hugging Face.",
          "Audio-Zusammenfassungen und Podcasts werden von Stimmen gelesen, die auf diesem Gerät laufen, sodass das Skript es nie verlässt, oder vom Sprachmodell Ihres KI-Anbieters. Geräte-Stimmen werden einmalig von Hugging Face geladen.",
        )}
      </p>
      {VOICE_LANGS.map((lang) => (
        <LanguageVoices key={lang} lang={lang} prefs={p} set={set} />
      ))}
      <ProviderVoices prefs={p} set={set} />
      <Field label={t(`Speed: ${Math.round(p.speed * 100)} %`, `Vitesse : ${Math.round(p.speed * 100)} %`, `Tempo: ${Math.round(p.speed * 100)} %`)}>
        <input type="range" min={0.7} max={1.3} step={0.05} value={p.speed} onChange={(e) => set({ speed: Number(e.currentTarget.value) })} />
      </Field>
      <p className="meta">
        {t(
          "Kokoro (Apache-2.0) reads English; Piper voices read French (Jessica and Pierre: CC-BY-SA 4.0, Siwis: CC-BY 4.0) and German (Kerstin, Thorsten: CC0). eSpeak NG (GPL-3.0) turns the text into phonemes. Other languages use the provider's voice.",
          "Kokoro (Apache-2.0) lit l'anglais ; des voix Piper lisent le français (Jessica et Pierre : CC-BY-SA 4.0, Siwis : CC-BY 4.0) et l'allemand (Kerstin, Thorsten : CC0). eSpeak NG (GPL-3.0) transforme le texte en phonèmes. Les autres langues utilisent la voix du fournisseur.",
          "Kokoro (Apache-2.0) liest Englisch; Piper-Stimmen lesen Französisch (Jessica und Pierre: CC-BY-SA 4.0, Siwis: CC-BY 4.0) und Deutsch (Kerstin, Thorsten: CC0). eSpeak NG (GPL-3.0) wandelt den Text in Phoneme um. Andere Sprachen nutzen die Stimme des Anbieters.",
        )}
      </p>
    </div>
  );
}

function LanguageVoices({ lang, prefs, set }: { lang: VoiceLang; prefs: VoicePrefs; set: (p: Partial<VoicePrefs>) => void }) {
  const { t } = useLang();
  const [busy, setBusy] = useState<{ ratio?: number } | null>(null);
  const [error, setError] = useState("");
  const [sample, setSample] = useState<string>();
  useEffect(() => {
    return () => {
      if (sample) URL.revokeObjectURL(sample);
    };
  }, [sample]);
  const engine = prefs.engine[lang];
  const pair = prefs.voices[lang];
  const files = filesFor(pair);
  const need = missing(files);
  const name = languageLabel(lang);
  const run = async (job: () => Promise<void>) => {
    setError("");
    setBusy({});
    try {
      await job();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  return (
    <fieldset className="choices">
      <legend>{name.charAt(0).toUpperCase() + name.slice(1)}</legend>
      <Segmented
        label={t(`Voices for ${name}`, `Voix pour : ${name}`, `Stimmen für ${name}`)}
        options={[
          { id: "device", label: t("On this device", "Sur cet appareil", "Auf diesem Gerät") },
          { id: "provider", label: t("Provider's voice", "Voix du fournisseur", "Stimme des Anbieters") },
        ]}
        value={engine}
        onChange={(e) => set({ engine: { ...prefs.engine, [lang]: e } })}
      />
      {engine === "device" ? (
        <>
          <div className="row wrap">
            {[0, 1].map((i) => (
              <Field key={i} label={i === 0 ? t("Narrator, first host", "Narration, premier animateur", "Erzähler, erster Moderator") : t("Second host", "Second animateur", "Zweiter Moderator")}>
                <select
                  value={pair[i]}
                  onChange={(e) => {
                    const next: [string, string] = [...pair];
                    next[i] = e.currentTarget.value;
                    set({ voices: { ...prefs.voices, [lang]: next } });
                  }}
                >
                  {voicesOf(lang).map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.name} · {v.gender === "f" ? t("female", "féminine", "weiblich") : t("male", "masculine", "männlich")} · {v.model === "kokoro" ? "Kokoro" : "Piper"}
                    </option>
                  ))}
                </select>
              </Field>
            ))}
          </div>
          {busy ? <ProgressBar ratio={busy.ratio} label={t("Downloading the voices…", "Téléchargement des voix…", "Stimmen werden geladen…")} /> : null}
          <div className="row wrap">
            <span className="meta">
              {need.length
                ? t(`To download once: ${bytes(totalBytes(need))}`, `À télécharger une fois : ${bytes(totalBytes(need))}`, `Einmalig zu laden: ${bytes(totalBytes(need))}`)
                : t(`On this device (${bytes(totalBytes(files))})`, `Sur cet appareil (${bytes(totalBytes(files))})`, `Auf diesem Gerät (${bytes(totalBytes(files))})`)}
            </span>
            {need.length ? (
              <button type="button" className="secondary small" disabled={Boolean(busy)} onClick={() => run(() => downloadFiles(need, { progress: (loaded, total) => setBusy({ ratio: loaded / total }) }))}>
                <Icon name="download" size={16} /> {t("Download", "Télécharger", "Laden")}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="secondary small"
                  disabled={Boolean(busy)}
                  onClick={() =>
                    run(async () => {
                      const s = await speak(
                        SAMPLE[lang].map((text, speaker) => ({ speaker, text })),
                        { language: lang },
                      );
                      setSample(URL.createObjectURL(s.audio));
                    })
                  }
                >
                  <Icon name="play" size={16} /> {t("Listen", "Écouter", "Anhören")}
                </button>
                <button type="button" className="link small" disabled={Boolean(busy)} onClick={() => run(() => removeFiles(files))}>
                  {t("Remove from this device", "Retirer de cet appareil", "Von diesem Gerät entfernen")}
                </button>
              </>
            )}
          </div>
          {sample ? <audio className="player" src={sample} controls autoPlay aria-label={t("Sample", "Exemple", "Beispiel")} /> : null}
        </>
      ) : null}
      {error ? <Notice kind="error">{error}</Notice> : null}
    </fieldset>
  );
}

function ProviderVoices({ prefs, set }: { prefs: VoicePrefs; set: (p: Partial<VoicePrefs>) => void }) {
  const { t } = useLang();
  const r = speechTarget(savedSettings(), prefs.providerModel);
  const voices = "target" in r ? PROVIDER_VOICES[r.target.sdk] : [];
  return (
    <fieldset className="choices">
      <legend>{t("Provider's voice", "Voix du fournisseur", "Stimme des Anbieters")}</legend>
      {"target" in r ? (
        <p className="meta">{t(`Read by ${recipient()} (${r.target.model}), which receives the script.`, `Lu par ${recipient()} (${r.target.model}), qui reçoit le script.`, `Gelesen von ${recipient()} (${r.target.model}), das das Skript erhält.`)}</p>
      ) : (
        <p className="meta">{r.problem}</p>
      )}
      <Field label={t("Voice model (optional)", "Modèle de voix (facultatif)", "Sprachmodell (optional)")} hint={t("Empty: the provider's default.", "Vide : celui du fournisseur par défaut.", "Leer: der Standard des Anbieters.")}>
        <input type="text" spellCheck={false} value={prefs.providerModel} onChange={(e) => set({ providerModel: e.currentTarget.value.trim() })} placeholder={"target" in r ? r.target.model : ""} />
      </Field>
      <div className="row wrap">
        {[0, 1].map((i) => (
          <Field key={i} label={i === 0 ? t("Narrator, first host", "Narration, premier animateur", "Erzähler, erster Moderator") : t("Second host", "Second animateur", "Zweiter Moderator")}>
            {voices.length ? (
              <select
                value={prefs.providerVoices[i] || voices[i]}
                onChange={(e) => {
                  const next: [string, string] = [...prefs.providerVoices];
                  next[i] = e.currentTarget.value;
                  set({ providerVoices: next });
                }}
              >
                {voices.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type="text"
                spellCheck={false}
                value={prefs.providerVoices[i]}
                onChange={(e) => {
                  const next: [string, string] = [...prefs.providerVoices];
                  next[i] = e.currentTarget.value.trim();
                  set({ providerVoices: next });
                }}
              />
            )}
          </Field>
        ))}
      </div>
    </fieldset>
  );
}
