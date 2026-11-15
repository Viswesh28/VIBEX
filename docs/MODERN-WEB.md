# Modern Web Guidance in VIBEX

[Modern Web Guidance](https://developer.chrome.com/docs/modern-web-guidance) is a
set of coding-agent skills from Google Chrome, stewarded with the Microsoft Edge,
Mozilla Firefox and MDN teams. It gives an agent current, browser-compatibility-
aware guides (dialogs, forms, dark mode, Core Web Vitals, accessibility, PWA and
more) to follow instead of patterns remembered from old training data. It also
ships a scanner, `legacy-scan`, that flags known legacy patterns.

This repository vendors those skills for every coding agent that works on it,
and checks itself against the scanner with `npm run verify:modern-web`.

## What was added

| Path | What it is |
|---|---|
| `.agents/skills/modern-web-guidance/` | The skill: `SKILL.md` and 209 guides. Agents search and retrieve them through the `modern-web-guidance` CLI. |
| `.agents/skills/chrome-extensions/` | Companion skill for Manifest V3 extensions (`extension/`): `SKILL.md` and 23 references. |
| `.agents/skills/LICENSE` | Upstream Apache-2.0 licence for both skills (see `NOTICE.md`). |
| `.claude/skills/*` | Symlinks into `.agents/skills/`, which is where Claude Code looks for skills. |
| `skills-lock.json` | Source and content hash of each skill (`skills` CLI, lock format v2). |
| `.mwgrc` | The project's browser-support target for the guides: `"baseline": "widely"`. |
| `music-app` devDependency `modern-web-guidance` `1.0.0` | The CLI and scanner, pinned exactly. |
| `music-app/modern-web-verify.mjs` | The repository check behind `npm run verify:modern-web`. |
| `AGENTS.md`, `CLAUDE.md` | When agents must use the skills, and which checks to run. |

**Provenance.** The skills come from
[GoogleChrome/modern-web-guidance](https://github.com/GoogleChrome/modern-web-guidance)
at commit `4dd968349e54ca45a05dd5c818fb035c9054b022` (`main` on 2026-11-15). The
`SKILL.md` and guides are byte-identical to those inside the npm package
`modern-web-guidance@1.0.0` (guides version `2026_11_09-5bcc021b`), which is the
version the check runs. They were installed with the official tooling:

```bash
npx skills@1.8.1 add GoogleChrome/modern-web-guidance --skill '*' \
  -a claude-code -a codex -a cursor -a github-copilot -a gemini-cli -y
npx modern-web-guidance set-baseline widely
cd music-app && npm install --save-dev --save-exact modern-web-guidance@1.0.0
```

The installer writes the files once, to `.agents/skills/`, which Codex, Cursor,
GitHub Copilot and Gemini CLI read directly, and links them for Claude Code.

**Browser-support target.** `"widely"` (Baseline Widely available) is also the
CLI's default. It is written down because the same front-end runs inside Android
System WebView and as an iPhone home-screen web app, and so that relaxing it is
a visible, reviewed change: `npx modern-web-guidance set-baseline newly` (or a
year such as `2024`).

**Telemetry.** The CLI sends Google anonymous usage data (install counts, agent
name, guide IDs, search queries — not prompts) unless `DISABLE_TELEMETRY=1` is
set. `verify:modern-web` sets it for its own run. Agents calling
`npx modern-web-guidance` follow your shell environment, so add
`export DISABLE_TELEMETRY=1` to your shell profile to opt out everywhere.

## How agents use it

For any HTML, CSS or client-side JS task the skill makes the agent:

1. `search` with a short capability query, e.g. `"light dismiss dialog"`;
2. `retrieve` the matching guide(s) and follow them, including the fallbacks
   the Baseline target calls for;
3. check the finished change against the guide;
4. end its reply with a `### Modern Web Guidance` section naming the guides it
   applied.

`AGENTS.md` makes this mandatory for `music-app/` and points work on
`extension/` at the `chrome-extensions` skill.

## The repository check: `npm run verify:modern-web`

Run it from `music-app/` after `npm ci`. It needs Node 22+ and no network:

```
Modern Web Guidance — repository check

Agent skills (.agents/skills, skills-lock.json)
  [  ok  ] skill chrome-extensions — 24 files match skills-lock.json (GoogleChrome/modern-web-guidance)
  [  ok  ] skill modern-web-guidance — 210 files match skills-lock.json (GoogleChrome/modern-web-guidance)

Project config (.mwgrc)
  [  ok  ] .mwgrc — Baseline target "widely"

Legacy web-platform patterns (legacy-scan)
  scanner: modern-web-guidance 1.0.0, guides 2026_11_09-5bcc021b
  [  ok  ] legacy-scan — 0 open findings (35 rules from 33 guides, 54 docs/tests skipped)

============================================================
PASS 0 findings
```

| Check | Fails when | What to do |
|---|---|---|
| Vendored skills | A skill is missing, or its files no longer hash to the value in `skills-lock.json` (same algorithm as the `skills` CLI). `npx skills update` reports a hand-edited skill as "up to date", so nothing else would catch it. | Undo the edit with `git checkout -- .agents/skills/<name>`. To upgrade on purpose, run `npx skills update -p` and commit the skills with the lock file. |
| `.claude` links | Only warns: Claude Code would not load the skill. Typical on Windows checkouts without symlink support. | `git config core.symlinks true`, then check the links out again. |
| `.mwgrc` | Invalid JSON, which makes every `retrieve` fail, or a `baseline` the CLI doesn't understand, which it would silently treat as `widely`. | `npx modern-web-guidance set-baseline widely` |
| `legacy-scan` | Any finding from the pinned scanner over the whole repository. The scanner itself skips `node_modules`, build output, docs and tests. | Check the finding against its keep-when / drop-when rubric. Fix it using the guide, or add a reviewed false positive to `ACCEPTED` in the script, with the reason. |

The scanner version is pinned so that a new upstream rule cannot break the check
without a reviewed bump. Without `node_modules` the script falls back to
`npx -y modern-web-guidance@<pinned version>`.

**CI.** `docs/ci.yml.example` has a `modern-web` job on Node 22. The other jobs
stay on Node 20.

**Scope.** `legacy-scan` covers about 20% of the guide catalogue: the 33 guides
that have deterministic rules. The rest of the catalogue is applied through the
agent workflow above, and by review, as below.

## Verification results — 2026-11-15

### `legacy-scan`

- **Before:** 1 finding. `ime-safe-enter-submit` at
  `music-app/src/components/TopBar.jsx:52`, where the search box ran
  `if (e.key === 'Enter') submit()`.
- **Reviewing the same rule found a second case the scanner missed.**
  `music-app/src/components/PlaylistModal.jsx:109` used
  `e.key === 'Enter' && submit()` in the playlist name field. A probe file
  confirmed that the 1.0.0 rule flags the `if (…)` form but not this
  short-circuit form.
- **Why it matters here:** input methods (IMEs) use Enter to confirm the word
  being composed. That covers Japanese, Chinese and Korean, and the
  transliteration IMEs used to type Tamil or Hindi. Both inputs submitted the
  half-typed text: a search for a fragment, or a playlist saved under it.
- **Fix:** `isSubmitEnter()` in `music-app/src/lib/keys.js` ignores an Enter
  that arrives with `isComposing` set, or with `keyCode === 229`. The 229 check
  is for Safari, which delivers `compositionend` before the confirming key
  (WebKit bug 165004). Both inputs use it.
  `music-app/test/imeEnter.spec.jsx` adds 7 tests; its two whole-app tests fail
  against the old handlers.
- **After:** 0 findings.

### Review against the rest of the catalogue

These are the guides that apply to VIBEX's main surfaces. Only the IME fix was
changed in this pass. Items marked ⚠️ are recommendations: they change visuals
or structure and need a browser-based check before they ship.

| Area | Guide(s) | Status | Notes |
|---|---|---|---|
| Enter-to-submit inputs | `ime-safe-enter-submit` | ✅ fixed | See above. |
| Web app manifest | `install-web-app` | ✅ | Stable `"id": "/"` and manifest URL; served as `application/manifest+json` (`vercel.json`). |
| Install button | `install-web-app` | ✅ | `beforeinstallprompt` is captured and the single-use event is cleared before prompting (`lib/install.js`). `<install>` and `navigator.install()` are not shipped by any major browser yet; revisit once they are. |
| Reduced motion | `motion` | ✅ | A global `prefers-reduced-motion: reduce` block drops animations and smooth scrolling. |
| Below-the-fold images | `optimize-image-priority` | ✅ | `loading="lazy"` on card, song-row and queue art; hero art loads eagerly. |
| Canvas video | `lazy-load-video-and-audio` | ✅ | `preload="none"`, muted, `playsInline`, no poster; only rendered when a clip exists. |
| Viewport height | `responsive-design` | ✅ | `100dvh` with a `100vh` fallback. |
| Modal overlays | `dialog`, `accessibility`, `light-dismiss-a-dialog`, `prevent-page-scroll-under-modal-dialog` | ⚠️ | Full player, lyrics, playlist picker and YouTube player are `div role="dialog" aria-modal="true"`. Nothing makes the page behind them inert, so Tab can reach controls underneath. Native `<dialog>` + `showModal()` provides that, plus Esc handling, focus return and `closedby="any"` light dismiss. At minimum, set `inert` on the app shell while an overlay is open. The settings panel is a non-modal `role="dialog"` and would suit `popover`. Largest item: it touches the Escape stack in `App.jsx` and `test/app.spec.jsx`. |
| Seek bars | `slider` | ⚠️ | Three custom `div role="slider"` seek bars (`PlayerBar.jsx:41`, `FullPlayer.jsx:127`, `NowPlaying.jsx:73`). The guide asks for a native `<input type="range">`, which volume and crossfade already use. |
| Scrollbars | `customize-scrollbar-color-and-thickness` | ⚠️ | The global scrollbar is styled only with `::-webkit-scrollbar` (`global.css:149-152`); there is no `scrollbar-color`, so Firefox gets no theming. The scanner has a rule for this, but its rubric drops any stylesheet that declares `scrollbar-width` somewhere, and `global.css` does (line 587 and the `.tabs` strip). Moving to the standard properties drops the thumb radius and hover colour in Chromium, and the guide asks for 3:1 thumb contrast, so it needs a visual review. |
| Colour scheme | `dark-mode`, `dark-mode-toggle` | ⚠️ | `<meta name="color-scheme" content="dark light">` and a per-theme `color-scheme` are in place. A first visit is always dark, though; the guide asks to follow the system preference by default and store only an explicit override. This may be a deliberate product choice. |
| LCP image | `optimize-image-priority` | ⚠️ measure first | No `fetchpriority` anywhere. The likely LCP element is the feed hero (`.hero-cover` and `.hero-wash` share one URL), but it hasn't been measured. Confirm with a performance trace, then add `fetchpriority="high"` (lowercase under React 18). |

### Extension (`chrome-extensions` skill)

`legacy-scan` covered `extension/` too, with no findings. Against the skill's
mandatory rules: Manifest V3 throughout, no icon files referenced, no `eval` or
`new Function`, and no state kept in the service worker between events. One
item for the store-review checklist ("No unused permissions — leftover
permissions cause rejection"): nothing calls `chrome.scripting`, and
`tabs.create`, `tabs.remove` and `tabs.sendMessage` do not need the `tabs`
permission. So `"scripting"` and `"tabs"` look removable; confirm in a browser
before changing `manifest.json`.

## Keeping it current

- **Guides:** `npx skills update -p`, review the diff, and commit
  `.agents/skills/` together with `skills-lock.json`. The lock file records
  content hashes, not a commit, so a fresh install always takes upstream
  `main`; the committed folder is the pinned copy.
- **Scanner:** `npm install --save-dev --save-exact modern-web-guidance@<version>`
  in `music-app/`, then `npm run verify:modern-web`. Fix or triage any new
  findings in the same change.
- **Removing a skill:** `npx skills remove chrome-extensions` deletes the skill,
  its links and its lock entry.
