"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Profile } from "@/lib/account";
import type { Lang } from "@/lib/i18n";
import { setNickname } from "@/lib/account";

interface NavbarProps {
  profile: Profile | null;
  lang: Lang;
  onSignIn: () => void;
  onSignOut: () => void;
  onLang: (l: Lang) => void;
}

const wrap: CSSProperties = {
  position: "fixed",
  top: 12,
  right: 12,
  zIndex: 60,
  display: "flex",
  alignItems: "center",
  gap: 10,
};
const pill: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  background: "#302e2b",
  border: "1px solid #443f3a",
  borderRadius: 999,
  padding: "4px 6px 4px 12px",
  boxShadow: "0 6px 18px rgba(0,0,0,.3)",
};
const nameStyle: CSSProperties = {
  maxWidth: 150,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  fontSize: 13,
  fontWeight: 700,
  color: "#ece8e0",
  display: "inline-flex",
  alignItems: "center",
  gap: 5,
  cursor: "text",
  borderBottom: "1px dashed transparent",
};
const nameInput: CSSProperties = {
  font: "inherit",
  fontSize: 13,
  fontWeight: 700,
  color: "#ece8e0",
  background: "#262421",
  border: "1px solid #d7a95c",
  borderRadius: 6,
  padding: "1px 6px",
  width: "9em",
  maxWidth: "40vw",
  outline: "none",
};
const eloStyle: CSSProperties = {
  fontSize: 11,
  fontWeight: 800,
  color: "#d7a95c",
  background: "rgba(215,169,92,.14)",
  border: "1px solid rgba(215,169,92,.4)",
  padding: "2px 8px",
  borderRadius: 999,
  fontVariantNumeric: "tabular-nums",
};
const btn: CSSProperties = {
  cursor: "pointer",
  fontSize: 12,
  fontWeight: 700,
  padding: "7px 13px",
  borderRadius: 999,
  border: "1px solid #443f3a",
  background: "#302e2b",
  color: "#ece8e0",
  boxShadow: "0 6px 18px rgba(0,0,0,.3)",
};
const btnPrimary: CSSProperties = {
  ...btn,
  display: "flex",
  alignItems: "center",
  gap: 8,
  background: "#d7a95c",
  color: "#241f18",
  border: "1px solid transparent",
};
const langWrap: CSSProperties = {
  display: "flex",
  gap: 3,
  padding: 3,
  background: "#302e2b",
  border: "1px solid #443f3a",
  borderRadius: 10,
  boxShadow: "0 6px 18px rgba(0,0,0,.3)",
};
const langBtn = (active: boolean): CSSProperties => ({
  cursor: "pointer",
  border: "none",
  fontSize: 12,
  fontWeight: 700,
  padding: "5px 11px",
  borderRadius: 7,
  background: active ? "#d7a95c" : "transparent",
  color: active ? "#241f18" : "#9b948a",
});

// tiny pencil icon
function PencilIcon() {
  return (
    <svg
      width="11"
      height="11"
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ opacity: 0.55, flex: "0 0 auto" }}
    >
      <path
        fill="#d7a95c"
        d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.58z"
      />
    </svg>
  );
}

export default function Navbar({
  profile,
  lang,
  onSignIn,
  onSignOut,
  onLang,
}: NavbarProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const startEdit = () => {
    if (!profile) return;
    setDraft(profile.nickname);
    setEditing(true);
  };
  const commit = () => {
    setEditing(false);
    const n = draft.trim().slice(0, 18);
    if (profile && n && n !== profile.nickname) {
      setNickname(profile.uid, n).catch(() => {}); // Firestore write; live snapshot updates the pill
      try {
        localStorage.setItem("chess-nick", n);
      } catch {
        /* noop */
      }
    }
  };

  const hint =
    lang === "fr" ? "Double-cliquez pour renommer" : "Double-click to rename";

  return (
    <div style={wrap}>
      {profile ? (
        <>
          <div style={pill}>
            {editing ? (
              <input
                ref={inputRef}
                style={nameInput}
                value={draft}
                maxLength={18}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={commit}
                onKeyDown={(e) => {
                  if (e.key === "Enter") commit();
                  if (e.key === "Escape") setEditing(false);
                }}
              />
            ) : (
              <span
                style={nameStyle}
                title={hint}
                onDoubleClick={startEdit}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.borderBottomColor = "#d7a95c")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.borderBottomColor = "transparent")
                }
              >
                {profile.nickname}
                <PencilIcon />
              </span>
            )}
            <span style={eloStyle}>♟ {profile.rating}</span>
          </div>
          <button
            style={{ ...btn, background: "transparent" }}
            onClick={onSignOut}
          >
            {lang === "fr" ? "Se déconnecter" : "Sign out"}
          </button>
        </>
      ) : (
        <button style={btnPrimary} onClick={onSignIn}>
          <svg width="15" height="15" viewBox="0 0 48 48" aria-hidden="true">
            <path
              fill="#4285F4"
              d="M45.12 24.5c0-1.56-.14-3.06-.4-4.5H24v8.51h11.84c-.51 2.75-2.06 5.08-4.39 6.64v5.52h7.11c4.16-3.83 6.56-9.47 6.56-16.17z"
            />
            <path
              fill="#34A853"
              d="M24 46c5.94 0 10.92-1.97 14.56-5.33l-7.11-5.52c-1.97 1.32-4.49 2.1-7.45 2.1-5.73 0-10.58-3.87-12.31-9.07H4.34v5.7C7.96 41.07 15.4 46 24 46z"
            />
            <path
              fill="#FBBC05"
              d="M11.69 28.18c-.44-1.32-.69-2.73-.69-4.18s.25-2.86.69-4.18v-5.7H4.34C2.85 17.09 2 20.45 2 24s.85 6.91 2.34 9.88l7.35-5.7z"
            />
            <path
              fill="#EA4335"
              d="M24 10.75c3.23 0 6.13 1.11 8.41 3.29l6.31-6.31C34.91 4.18 29.93 2 24 2 15.4 2 7.96 6.93 4.34 14.12l7.35 5.7c1.73-5.2 6.58-9.07 12.31-9.07z"
            />
          </svg>
          {lang === "fr" ? "Se connecter" : "Sign in"}
        </button>
      )}

      <div style={langWrap}>
        <button style={langBtn(lang === "en")} onClick={() => onLang("en")}>
          EN
        </button>
        <button style={langBtn(lang === "fr")} onClick={() => onLang("fr")}>
          FR
        </button>
      </div>
    </div>
  );
}
