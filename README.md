# Chess ♞ — Next.js

A full chess game (legal move validation, castling, en passant, promotion,
check/checkmate/stalemate, draws) with drag-and-drop + click-to-move, a move list
in algebraic notation, captured-piece tracking, and a built-in AI opponent
(negamax + alpha–beta). Built with **Next.js (App Router) + TypeScript**, no runtime
dependencies beyond React. The engine's move generator is verified with perft
(`perft(4) = 197281` from the start position).

## Requirements

- Node.js 18.18+ (20 LTS recommended)
- npm (or pnpm / yarn / bun)

---

## Run this project

```bash
npm install
npm run dev
```

Open http://localhost:3000.

Production build (what Vercel runs):

```bash
npm run build
npm start
```

---

## Build it from scratch (optional)

If you'd rather scaffold it yourself and drop the code in:

```bash
# 1. Create the app (accept: TypeScript = Yes, App Router = Yes, src/ = No, Tailwind = No)
npx create-next-app@latest chess-next
cd chess-next

# 2. Add the source files, replacing the generated ones:
#    app/layout.tsx
#    app/page.tsx
#    app/globals.css
#    lib/engine.ts
#    lib/ai.ts
#    lib/sound.ts
#    components/ChessGame.tsx
#    components/Board.tsx
#    components/SidePanel.tsx

# 3. Make sure tsconfig.json has the "@/*" path alias:
#    "paths": { "@/*": ["./*"] }

# 4. Run
npm run dev
```

You can delete the default `app/page.module.css` and `public/*.svg` that
`create-next-app` generates — this project doesn't use them.

---

## Deploy to Vercel

### Option A — Vercel CLI (fastest)

```bash
npm i -g vercel
vercel          # first run: log in + link the project, deploy a preview
vercel --prod   # promote to production
```

### Option B — Git + Vercel dashboard (recommended for real projects)

```bash
git init
git add .
git commit -m "Chess app"
# create an empty repo on GitHub, then:
git remote add origin https://github.com/<you>/chess-next.git
git branch -M main
git push -u origin main
```

1. Go to https://vercel.com/new
2. Import the GitHub repository.
3. Vercel auto-detects Next.js — no configuration needed. Framework preset:
   **Next.js**, Build command `next build`, Output handled automatically.
4. Click **Deploy**. Every future `git push` to `main` ships to production, and
   each pull request gets its own preview URL.

---

## Project structure

```
chess-next/
├── app/
│   ├── globals.css        # theme + board/panel styling
│   ├── layout.tsx
│   └── page.tsx
├── components/
│   ├── Board.tsx          # interactive board (drag + click, promotion)
│   ├── ChessGame.tsx      # state controller: engine, AI turn, undo
│   └── SidePanel.tsx      # status, controls, move list, captures
├── lib/
│   ├── engine.ts          # rules + move generation + SAN (perft-verified)
│   ├── ai.ts              # negamax + alpha-beta + piece-square tables
│   └── sound.ts           # Web Audio move sounds (no asset files)
├── next.config.mjs
├── tsconfig.json
└── package.json
```

## Notes

- The AI is a modest club-level engine, not Stockfish; "Hard" searches 3 plies.
- Search runs on the main thread after a short delay. For a heavier engine, move
  `bestMove` into a Web Worker (`new Worker(new URL("../lib/worker.ts", import.meta.url))`).

---

## Sharing a game (custom link)

Click **Copy game link** in the side panel. This builds a URL with the whole game
encoded in the hash, e.g. `https://your-app.vercel.app/#g=e2e4e7e5...`, and copies
it to your clipboard.

When someone opens that link, the board loads at that exact position **locked
(view-only)** with a 🔒 banner. They can press **Play from here** to unlock and
continue, or **New game** to start over. No account or database needed — the game
lives entirely in the link, so it works on a plain static Vercel deploy.

Note: this is a shareable *snapshot* (great for puzzles, "look at this position",
or continue-from-here). It is not live two-device play — that would need a backend
(e.g. a WebSocket server or a realtime service). Happy to add that if you want it.
