# AGENTS.md

Instructions for coding agents working in this repository. People should start
with [README.md](README.md). The reasoning behind this file, and the latest
verification results, are in [docs/MODERN-WEB.md](docs/MODERN-WEB.md).

## Repository map

- `music-app/` — React 18 + Vite front-end (`src/`, `index.html`, `public/`) and
  the Node gateway (`server.mjs`). Every npm script runs from here.
- `jiosaavn-api/` — vendored API fork (MIT, Sumit Kolhe), mounted in-process.
- `api/` — Vercel serverless entry points (see `docs/DEPLOY.md`).
- `extension/` — Manifest V3 browser extension, "VIBEX stream helper".
- `docs/` — deploy, engine and mobile notes, ADRs, the CI workflow template.

## Web platform guidance

Two agent skills from
[GoogleChrome/modern-web-guidance](https://github.com/GoogleChrome/modern-web-guidance)
are vendored in `.agents/skills/`. Codex, Cursor, GitHub Copilot and Gemini CLI
read that folder directly, and Claude Code reaches it through the
`.claude/skills/` links.

| Skill | Use it for |
|---|---|
| `modern-web-guidance` | Every HTML, CSS or client-side JS change: `music-app/src`, `music-app/index.html`, `music-app/public`. Follow its `SKILL.md`: search, retrieve, check your change against the guide, and end your reply with a `### Modern Web Guidance` section. |
| `chrome-extensions` | Every change under `extension/`. |

- **Browser support:** Baseline Widely available, recorded in `.mwgrc`. A
  feature outside that set needs the fallback its guide prescribes. The same
  front-end also ships inside Android System WebView (Capacitor) and as an
  iPhone home-screen web app, so a fallback must work there too.
- The skill runs `npx -y modern-web-guidance@latest …`. That needs network
  access to registry.npmjs.org, and it sends anonymous usage telemetry (search
  queries, guide IDs, agent name) unless `DISABLE_TELEMETRY=1` is set.
- Never edit `.agents/skills/` or `.claude/skills/` by hand: the check below
  compares them byte for byte with `skills-lock.json`. To take a newer upstream
  version, run `npx skills update -p` and commit the skills together with the
  lock file.

## Checks before you finish

From `music-app/`:

```bash
npm test                    # offline unit + integration tests
npm run verify:modern-web   # skills intact, .mwgrc valid, legacy-scan clean (Node 22+)
```

For layout or CSS changes, also run `npm run verify:mobile` and
`npm run verify:ux`. Both need Playwright's Chromium and a running gateway; see
the README.

If `verify:modern-web` reports a legacy-scan finding, check it against that
finding's keep-when / drop-when rubric. To print the rubric, run
`npx modern-web-guidance legacy-scan .. --json` from `music-app/`. Fix a real
finding by retrieving its guide. Add a verified false positive to `ACCEPTED` in
`music-app/modern-web-verify.mjs`, with the reason. Never rewrite correct code
just to silence the scanner.
