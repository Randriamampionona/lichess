"use client";

import { useEffect, useRef, useState } from "react";
import { Lang, tr, TKey } from "@/lib/i18n";

export type ChatMsg = { from: "me" | "them"; nick: string; quick: boolean; key?: TKey; text?: string; color?: string };

export type QuickSend = { quick: boolean; key?: TKey; text?: string; color?: string };

const QUICKS: { key: TKey; color: string }[] = [
  { key: "qGg", color: "#d7a95c" },
  { key: "qGl", color: "#5bb7e6" },
  { key: "qNice", color: "#6fce7d" },
  { key: "qOops", color: "#e79a55" },
  { key: "qThanks", color: "#c79be6" },
  { key: "qWp", color: "#e87ba0" },
  { key: "qMove", color: "#9aa7b6" },
];

interface ChatProps {
  lang: Lang;
  chat: ChatMsg[];
  onSend: (m: QuickSend) => void;
}

export default function Chat({ lang, chat, onSend }: ChatProps) {
  const t = (k: TKey) => tr(lang, k);
  const [msg, setMsg] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { endRef.current?.scrollIntoView({ block: "nearest" }); }, [chat.length]);

  const submit = () => {
    const clean = msg.trim();
    if (!clean) return;
    onSend({ quick: false, text: clean });
    setMsg("");
  };

  return (
    <aside className="chat-panel">
      <div className="chat-head">💬 {t("chatTitle")}</div>

      <div className="chat-log">
        {chat.map((m, i) => {
          const body = m.quick && m.key ? t(m.key) : m.text ?? "";
          const prev = chat[i - 1];
          const showNick = !prev || prev.from !== m.from || prev.nick !== m.nick;
          return (
            <div key={i} className={"cwrap " + m.from}>
              {showNick && <span className="cnick">{m.nick}</span>}
              <div
                className={"cmsg " + m.from + (m.quick ? " quick" : "")}
                style={m.quick && m.color ? { background: m.color, color: "#1b1e22" } : undefined}
              >
                {body}
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="quicks">
        {QUICKS.map((q) => (
          <button key={q.key} style={{ borderColor: q.color, color: q.color }} onClick={() => onSend({ quick: true, key: q.key, color: q.color })}>
            {t(q.key)}
          </button>
        ))}
      </div>

      <div className="chat-input">
        <input
          value={msg}
          maxLength={200}
          placeholder={t("chatPlaceholder")}
          onChange={(e) => setMsg(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") submit(); }}
        />
        <button onClick={submit} aria-label={t("send")}>➤</button>
      </div>
    </aside>
  );
}
