"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { watchAuth, signInWithGoogle } from "@/lib/account";

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const next = params.get("next") || "/";
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);

  // if already signed in (or after sign-in), bounce to the target
  useEffect(() => {
    const unsub = watchAuth((u) => {
      if (u) {
        // next may include a hash (e.g. /#live=abc) — use a hard nav so the hash is applied
        window.location.href = decodeURIComponent(next);
      }
    });
    return () => unsub();
  }, [next]);

  const onSignIn = async () => {
    setErr(false);
    setBusy(true);
    try {
      await signInWithGoogle();
      // redirect handled by the watchAuth effect above
    } catch {
      setErr(true);
      setBusy(false);
    }
  };

  return (
    <div style={styles.wrap}>
      <div style={styles.card}>
        <div style={styles.brand}>
          Chess<span style={{ color: "#d7a95c" }}>♟</span>
        </div>
        <p style={styles.sub}>Sign in to play a live game with your friend.</p>

        <button style={styles.btn} onClick={onSignIn} disabled={busy}>
          <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
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
          {busy ? "Signing in…" : "Sign in with Google"}
        </button>

        {err && <p style={styles.err}>Sign-in failed — please try again.</p>}

        <button style={styles.ghost} onClick={() => router.push("/")}>
          Continue without signing in
        </button>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: {
    minHeight: "100vh",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#262421",
    padding: 20,
  },
  card: {
    width: "100%",
    maxWidth: 360,
    textAlign: "center",
    background: "#302e2b",
    border: "1px solid #443f3a",
    borderRadius: 18,
    padding: "34px 28px",
    boxShadow: "0 30px 80px rgba(0,0,0,.6)",
    borderTop: "5px solid #d7a95c",
  },
  brand: {
    fontFamily: "Georgia, serif",
    fontSize: 30,
    fontWeight: 700,
    color: "#ece8e0",
    marginBottom: 6,
  },
  sub: { color: "#9b948a", fontSize: 14, margin: "0 0 22px" },
  btn: {
    display: "inline-flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    justifyContent: "center",
    cursor: "pointer",
    fontSize: 14,
    fontWeight: 700,
    padding: "12px 16px",
    borderRadius: 10,
    border: "1px solid transparent",
    background: "#d7a95c",
    color: "#241f18",
  },
  ghost: {
    marginTop: 14,
    background: "transparent",
    border: "none",
    color: "#9b948a",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    textDecoration: "underline",
  },
  err: { color: "#e79a94", fontSize: 13, fontWeight: 600, marginTop: 12 },
};
