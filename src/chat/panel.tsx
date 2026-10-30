// The chat of a course or a lesson: the conversations, and one open at a
// time with its answers streaming in, citations that open the passage, and
// the exchange's summary.

import { useEffect, useRef, useState } from "react";
import { loadLlm, recipient, savedSettings } from "../ai/llm.ts";
import { fresh, get, list, put, remove } from "../data/db.ts";
import { useLive } from "../data/hooks.ts";
import type { Chat, Id, Source } from "../data/schema.ts";
import { count, currentLang, relative, useLang } from "../i18n.ts";
import { href } from "../router.ts";
import { hasText } from "../studio/panel.tsx";
import { openCitation } from "../ui/cite.ts";
import { Icon } from "../ui/icons.tsx";
import { Empty, Notice } from "../ui/kit.tsx";
import { Markdown } from "../ui/markdown.tsx";
import { answer, needsSummary, summarizeChat } from "./chat.ts";

export interface ChatPanelProps {
  courseId: Id;
  lessonId?: Id;
  /** Open this conversation (the tutor opens its own). */
  chatId?: Id;
  /** Added to the system prompt (the tutor's concept). */
  extraSystem?: string;
}

export function ChatPanel({ courseId, lessonId, chatId, extraSystem }: ChatPanelProps) {
  const { t } = useLang();
  const [open, setOpen] = useState<Id | null>(chatId ?? null);
  const data = useLive(
    async () => {
      await loadLlm();
      const [chats, sources, course] = await Promise.all([list("chats", "courseId", courseId), list("sources", "courseId", courseId), get("courses", courseId)]);
      return {
        chats: chats.filter((c) => (!lessonId || c.lessonId === lessonId) && c.mode === "chat").sort((a, b) => b.updatedAt - a.updatedAt),
        sources: sources.filter((s) => (!lessonId || s.lessonId === lessonId) && hasText(s)).sort((a, b) => a.createdAt - b.createdAt),
        language: course?.language || currentLang(),
        configured: Boolean(savedSettings()),
      };
    },
    ["chats", "sources", "courses"],
    [courseId, lessonId],
  );
  if (!data) return <div aria-busy="true" />;
  if (open) return <Conversation id={open} sources={data.sources} language={data.language} extraSystem={extraSystem} onBack={chatId ? undefined : () => setOpen(null)} />;
  const start = async () => {
    const chat = await put("chats", { ...fresh(), courseId, lessonId, mode: "chat", title: t("New conversation", "Nouvelle conversation", "Neues Gespräch"), messages: [] });
    setOpen(chat.id);
  };
  return (
    <section className="chat-list">
      {!data.configured ? (
        <Notice>
          {t("The chat uses your own AI provider.", "Le chat utilise votre propre fournisseur d'IA.", "Der Chat nutzt Ihren eigenen KI-Anbieter.")} <a href={href.settings("ai")}>{t("Set one up", "En configurer un", "Einen einrichten")}</a>
        </Notice>
      ) : null}
      <div className="row">
        <button type="button" className="primary" disabled={!data.configured || !data.sources.length} onClick={() => void start()}>
          <Icon name="plus" /> {t("Ask about these sources", "Poser une question sur ces sources", "Eine Frage zu diesen Quellen stellen")}
        </button>
      </div>
      {data.chats.length ? (
        <ul className="list">
          {data.chats.map((c) => (
            <li key={c.id} className="list-item">
              <button type="button" className="list-link" onClick={() => setOpen(c.id)}>
                <Icon name="chat" />
                <span className="list-main">
                  <span className="list-title">{c.title}</span>
                  <span className="meta">
                    {count(c.messages.length, ["message", "messages"], ["message", "messages"], ["Nachricht", "Nachrichten"])} · {relative(c.updatedAt)}
                    {c.summary ? ` · ${t("summarised", "résumé", "zusammengefasst")}` : ""}
                  </span>
                  {needsSummary(c) ? <span className="hint">{t("Long exchange: summarise it to keep what you learned.", "Échange long : résumez-le pour garder ce que vous avez appris.", "Langes Gespräch: Fassen Sie es zusammen, um das Gelernte zu behalten.")}</span> : null}
                </span>
              </button>
              <button type="button" className="icon-button" aria-label={t("Delete", "Supprimer", "Löschen")} onClick={() => void remove("chats", c.id)}>
                <Icon name="trash" size={18} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <Empty icon="chat" title={t("No conversation yet", "Aucune conversation", "Noch kein Gespräch")}>
          <p>{t("Ask what was unclear in class: answers come from your sources, with the page or the moment.", "Demandez ce qui n'était pas clair en cours : les réponses viennent de vos sources, avec la page ou le moment.", "Fragen Sie, was in der Vorlesung unklar war: Die Antworten stammen aus Ihren Quellen, mit Seite oder Zeitpunkt.")}</p>
        </Empty>
      )}
    </section>
  );
}

function Conversation({ id, sources, language, extraSystem, onBack }: { id: Id; sources: Source[]; language: string; extraSystem?: string; onBack?: () => void }) {
  const { t } = useLang();
  const chat = useLive(() => get("chats", id), ["chats"], [id]);
  const [question, setQuestion] = useState("");
  const [streaming, setStreaming] = useState<string | null>(null);
  const [summarizing, setSummarizing] = useState(false);
  const [error, setError] = useState("");
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  // A block body: scrollIntoView returns a promise in recent browsers, and React takes a returned value for a cleanup.
  useEffect(() => {
    void end.current?.scrollIntoView({ block: "end" });
  }, [chat?.messages.length, streaming]);
  useEffect(() => () => abort.current?.abort(), []);
  if (!chat) return <div aria-busy="true" />;
  const sourceIds = sources.map((s) => s.id);

  const send = async (q: string) => {
    if (!q.trim() || streaming !== null) return;
    setError("");
    setQuestion("");
    const asked: Chat = {
      ...chat,
      title: chat.messages.length ? chat.title : q.slice(0, 80),
      messages: [...chat.messages, { role: "user", content: q, at: Date.now() }],
    };
    await put("chats", asked);
    abort.current = new AbortController();
    let text = "";
    setStreaming("");
    try {
      for await (const part of answer(chat, sources, q, language, abort.current.signal, extraSystem)) {
        text += part;
        setStreaming(text);
      }
      const cur = (await get("chats", id)) ?? asked;
      await put("chats", { ...cur, messages: [...cur.messages, { role: "assistant", content: text, at: Date.now(), sourceIds }] });
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError(e instanceof Error ? e.message : String(e));
      if (text) {
        const cur = (await get("chats", id)) ?? asked;
        await put("chats", { ...cur, messages: [...cur.messages, { role: "assistant", content: text, at: Date.now(), sourceIds }] });
      }
    } finally {
      setStreaming(null);
    }
  };

  return (
    <section className="conversation">
      <div className="row between">
        {onBack ? (
          <button type="button" className="link" onClick={onBack}>
            <Icon name="chevron-left" size={18} /> {t("Conversations", "Conversations", "Gespräche")}
          </button>
        ) : (
          <span />
        )}
        <button
          type="button"
          className="secondary"
          disabled={chat.messages.length < 2 || summarizing || streaming !== null}
          onClick={async () => {
            setSummarizing(true);
            setError("");
            try {
              await summarizeChat(chat, sources, language);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setSummarizing(false);
            }
          }}
        >
          <Icon name="report" size={18} /> {summarizing ? t("Summarising…", "Résumé en cours…", "Wird zusammengefasst…") : t("Summarise the exchange", "Résumer l'échange", "Gespräch zusammenfassen")}
        </button>
      </div>
      {chat.summary ? (
        <details className="disclosure summary" open={!chat.messages.some((m) => m.at > (chat.summarizedAt ?? 0))}>
          <summary>{t("Summary of the exchange", "Résumé de l'échange", "Zusammenfassung des Gesprächs")}</summary>
          <Markdown text={chat.summary} />
          <p className="meta">{t("Also saved as a note among the sources.", "Aussi enregistré comme note parmi les sources.", "Auch als Notiz unter den Quellen gespeichert.")}</p>
        </details>
      ) : null}
      <ol className="messages" aria-live="polite">
        {chat.messages.map((m) => (
          <li key={m.at} className={`message ${m.role}`}>
            {m.role === "assistant" ? <Markdown text={m.content} onCite={(l) => openCitation(l, m.sourceIds ?? sourceIds)} /> : <p>{m.content}</p>}
          </li>
        ))}
        {streaming !== null ? (
          <li className="message assistant">{streaming ? <Markdown text={streaming} /> : <span className="typing" aria-label={t("Answering…", "Réponse…", "Antwort…")} />}</li>
        ) : null}
      </ol>
      <div ref={end} />
      {error ? <Notice kind="error">{error}</Notice> : null}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          void send(question);
        }}
      >
        <textarea
          rows={2}
          value={question}
          aria-label={t("Your question", "Votre question", "Ihre Frage")}
          placeholder={t("Ask a question…", "Posez une question…", "Stellen Sie eine Frage…")}
          onChange={(e) => setQuestion(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void send(question);
            }
          }}
        />
        {streaming !== null ? (
          <button type="button" className="secondary" onClick={() => abort.current?.abort()}>
            <Icon name="stop" size={18} /> {t("Stop", "Arrêter", "Stopp")}
          </button>
        ) : (
          <button type="submit" className="primary" disabled={!question.trim()} aria-label={t("Send", "Envoyer", "Senden")}>
            <Icon name="send" size={18} />
          </button>
        )}
      </form>
      <p className="meta">{t(`Passages of ${count(sources.length, ["source", "sources"], ["source", "sources"], ["Quelle", "Quellen"])} go to ${recipient()} with each question.`, `Des passages de ${count(sources.length, ["source", "sources"], ["source", "sources"], ["Quelle", "Quellen"])} partent chez ${recipient()} avec chaque question.`, `Mit jeder Frage gehen Passagen aus ${count(sources.length, ["source", "sources"], ["source", "sources"], ["Quelle", "Quellen"])} an ${recipient()}.`)}</p>
    </section>
  );
}
