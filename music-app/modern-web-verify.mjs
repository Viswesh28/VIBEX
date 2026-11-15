#!/usr/bin/env node
/**
 * Modern Web Guidance check for the whole repository.
 *
 *   npm run verify:modern-web             # from music-app/, after npm ci
 *
 * Three checks, all offline:
 *
 *   1. The agent skills vendored from GoogleChrome/modern-web-guidance
 *      (.agents/skills/<name>) are present and byte-for-byte what
 *      skills-lock.json recorded, and the .claude/skills links reach them.
 *      An edited guide silently changes what every coding agent is told, and
 *      `npx skills update` reports a hand-edited skill as "up to date", so a
 *      mismatch is a finding here.
 *   2. .mwgrc, the project's browser-support target, parses and names a target
 *      the CLI understands. Invalid JSON makes every `retrieve` fail, and an
 *      unknown target is quietly treated as "widely".
 *   3. `modern-web-guidance legacy-scan` over the repository reports no legacy
 *      web-platform pattern. In 1.0.0 that is 35 deterministic rules from 33
 *      guides (~20% of the catalogue). The scanner skips node_modules, build
 *      output, docs and tests on its own.
 *
 * The scanner is the exact-pinned `modern-web-guidance` devDependency, so a new
 * rule cannot fail this check without a reviewed version bump. Without
 * node_modules it falls back to `npx -y modern-web-guidance@<that version>`.
 * It needs Node 22+. Its anonymous usage telemetry is switched off for this run
 * unless DISABLE_TELEMETRY is already set in the environment.
 *
 * A finding that has been reviewed and is a false positive goes in ACCEPTED
 * below, with the reason. Exits 0 only with zero findings.
 */
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const APP_DIR = dirname(fileURLToPath(import.meta.url))
const REPO = join(APP_DIR, '..')
const MIN_NODE = 22

/**
 * Reviewed false positives: `{ guide, file, reason }`, with `file` relative to
 * the repository root exactly as the scanner prints it. There is deliberately
 * no line number, so an unrelated edit higher up the file does not bring a
 * reviewed finding back.
 */
const ACCEPTED = []

const findings = []
const note = (check, message, ...detail) => {
  findings.push({ check, message })
  console.log(`  [finding] ${check}: ${message}`)
  for (const line of detail.filter(Boolean)) console.log(`            ${line}`)
}
const ok = (check, detail = '') => console.log(`  [  ok  ] ${check}${detail ? ` — ${detail}` : ''}`)
const warn = (check, message) => console.log(`  [ warn ] ${check}: ${message}`)

// ------------------------------------------------- 1. vendored agent skills

// The `skills` CLI leaves these out of a skill's content hash.
const HASH_SKIP_FILES = new Set(['metadata.json'])
const HASH_SKIP_DIRS = new Set(['.git', '__pycache__', '__pypackages__'])

/** Every file of a skill, as the `skills` CLI walks it (symlinks kept inside the skill). */
function skillFiles(dir, prefix = '', root = realpathSync(dir), ancestors = new Set()) {
  const real = realpathSync(dir)
  if (ancestors.has(real)) return []
  const branch = new Set(ancestors).add(real)
  const files = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (HASH_SKIP_FILES.has(entry.name)) continue
    const full = join(dir, entry.name)
    let isDir = entry.isDirectory()
    if (entry.isSymbolicLink()) {
      let target
      try {
        target = realpathSync(full)
      } catch {
        continue
      }
      if (target !== root && !target.startsWith(root + sep)) continue
      isDir = statSync(target).isDirectory()
    } else if (!isDir && !entry.isFile()) {
      continue
    }
    if (isDir) {
      if (!HASH_SKIP_DIRS.has(entry.name)) {
        files.push(...skillFiles(full, `${prefix}${entry.name}/`, root, branch))
      }
    } else {
      files.push({ path: prefix + entry.name, content: readFileSync(full) })
    }
  }
  return files
}

/**
 * The digest skills-lock.json (version 2) stores as `computedHash`: sha256 over
 * path, size and bytes of every file, sorted by path, with CRLF read as LF so a
 * Windows checkout hashes the same as this one.
 */
function skillHash(files) {
  const entries = files.map(({ path, content }) => ({
    path: Buffer.from(path.split('\\').join('/'), 'utf8'),
    content:
      !content.includes(0) && content.includes('\r\n')
        ? Buffer.from(content.toString('latin1').replaceAll('\r\n', '\n'), 'latin1')
        : content,
  }))
  entries.sort((a, b) => Buffer.compare(a.path, b.path))
  const hash = createHash('sha256')
  for (const { path, content } of entries) {
    hash.update(path)
    hash.update('\0')
    hash.update(String(content.length))
    hash.update('\0')
    hash.update(content)
  }
  return hash.digest('hex')
}

function checkSkills() {
  const lockPath = join(REPO, 'skills-lock.json')
  if (!existsSync(lockPath)) {
    note('skills', 'skills-lock.json is missing', 'restore: git checkout -- skills-lock.json')
    return
  }
  let lock
  try {
    lock = JSON.parse(readFileSync(lockPath, 'utf8'))
  } catch (e) {
    note('skills', `skills-lock.json is not valid JSON (${e.message})`)
    return
  }
  const names = Object.keys(lock?.skills || {})
  if (names.length === 0) {
    note('skills', 'skills-lock.json lists no skills')
    return
  }

  for (const name of names) {
    const entry = lock.skills[name]
    const check = `skill ${name}`
    const dir = join(REPO, '.agents', 'skills', name)
    if (!existsSync(join(dir, 'SKILL.md'))) {
      note(check, `.agents/skills/${name}/SKILL.md is missing`, `restore: git checkout -- .agents/skills/${name}`)
      continue
    }
    const files = skillFiles(dir)
    const actual = skillHash(files)
    if (actual !== entry.computedHash) {
      note(
        check,
        'content differs from skills-lock.json — the vendored guidance was edited by hand',
        `undo:   git checkout -- .agents/skills/${name}`,
        'update: npx skills update -p, then commit .agents/skills and skills-lock.json together'
      )
      continue
    }
    ok(check, `${files.length} files match skills-lock.json (${entry.source})`)

    // Claude Code reads .claude/skills; the installer links each skill there.
    const link = join(REPO, '.claude', 'skills', name)
    let linked = false
    try {
      linked =
        existsSync(join(link, 'SKILL.md')) &&
        (realpathSync(link) === realpathSync(dir) || skillHash(skillFiles(link)) === actual)
    } catch {
      linked = false
    }
    if (!linked) {
      warn(
        check,
        `.claude/skills/${name} does not reach .agents/skills/${name}, so Claude Code will not load it ` +
          '(on Windows: git config core.symlinks true, then check the link out again)'
      )
    }
  }
}

// ------------------------------------------------------------- 2. .mwgrc

/**
 * The CLI's own reading of the `baseline` field (`normalizeBaselineTarget` in
 * modern-web.mjs 1.0.0); null where the CLI would silently fall back to
 * "widely": an unknown word, an empty string, or a non-string such as 2024.
 */
function baselineTarget(raw) {
  if (typeof raw !== 'string') return null
  const t = raw.trim().toLowerCase()
  if (t === 'widely' || t === 'baseline widely available') return 'widely'
  if (t === 'newly' || t === 'baseline' || t === 'baseline newly available') return 'newly'
  if (t === 'limited' || t === 'limited availability') return 'limited'
  return /^(?:baseline\s+)?(\d{4})$/.exec(t)?.[1] ?? null
}

function checkMwgrc() {
  const path = join(REPO, '.mwgrc')
  if (!existsSync(path)) {
    ok('.mwgrc', 'absent — the CLI defaults to Baseline Widely available')
    return
  }
  let config
  try {
    config = JSON.parse(readFileSync(path, 'utf8'))
  } catch (e) {
    note('.mwgrc', `not valid JSON (${e.message}) — every guide retrieval would fail`)
    return
  }
  if (typeof config !== 'object' || config === null || Array.isArray(config)) {
    note('.mwgrc', 'must be a JSON object')
    return
  }
  const target = config.baseline === undefined ? 'widely' : baselineTarget(config.baseline)
  if (!target) {
    note(
      '.mwgrc',
      `baseline ${JSON.stringify(config.baseline)} is not a target the CLI understands; it would silently mean "widely"`,
      'use widely, newly, limited or a year: npx modern-web-guidance set-baseline widely'
    )
    return
  }
  const gates = ['allowOriginTrials', 'allowVolatileFeatures']
    .filter((key) => config[key] !== undefined)
    .map((key) => `${key}: ${config[key]}`)
  ok('.mwgrc', [`Baseline target "${target}"`, ...gates].join(', '))
}

// -------------------------------------------------------- 3. legacy-scan

/** The pinned scanner from node_modules, or the same version through npx. */
function scanner() {
  const require = createRequire(import.meta.url)
  try {
    const pkgPath = require.resolve('modern-web-guidance/package.json')
    const skillDir = join(dirname(pkgPath), 'skills', 'modern-web-guidance')
    const { version } = JSON.parse(readFileSync(pkgPath, 'utf8'))
    let guides = ''
    try {
      guides = `, guides ${readFileSync(join(skillDir, 'skill-version.txt'), 'utf8').trim()}`
    } catch {
      /* older packages have no skill-version.txt */
    }
    return {
      command: process.execPath,
      args: [join(skillDir, 'modern-web.mjs')],
      label: `modern-web-guidance ${version}${guides}`,
    }
  } catch {
    const pkg = JSON.parse(readFileSync(join(APP_DIR, 'package.json'), 'utf8'))
    const pinned = pkg.devDependencies?.['modern-web-guidance'] || 'latest'
    return {
      command: 'npx',
      args: ['-y', `modern-web-guidance@${pinned}`],
      label: `modern-web-guidance@${pinned} via npx (run npm ci to use the pinned local copy)`,
      shell: process.platform === 'win32',
    }
  }
}

/** The scan prints one JSON document; tolerate a stray notice line around it. */
function parseReport(stdout) {
  try {
    return JSON.parse(stdout)
  } catch {
    const start = stdout.indexOf('{')
    const end = stdout.lastIndexOf('}')
    if (start < 0 || end <= start) return null
    try {
      return JSON.parse(stdout.slice(start, end + 1))
    } catch {
      return null
    }
  }
}

function checkLegacyScan() {
  const major = Number(process.versions.node.split('.')[0])
  if (major < MIN_NODE) {
    note('legacy-scan', `modern-web-guidance needs Node ${MIN_NODE}+, this is ${process.version}`)
    return
  }

  const { command, args, label, shell = false } = scanner()
  console.log(`  scanner: ${label}`)
  const run = spawnSync(command, [...args, 'legacy-scan', '.', '--json'], {
    cwd: REPO,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell,
    env: { DISABLE_TELEMETRY: '1', ...process.env },
  })
  const report = run.error ? null : parseReport(run.stdout || '')
  if (!report || !Array.isArray(report.guides)) {
    const why = run.error?.message || (run.stderr || '').trim().split('\n').pop() || `exit ${run.status}`
    note('legacy-scan', `the scanner produced no report (${why})`)
    return
  }

  const all = report.guides.flatMap((guide) =>
    guide.rules.flatMap((rule) =>
      rule.findings.map((finding) => ({
        ...finding,
        guide: guide.guideId,
        retrieve: `npx -y modern-web-guidance@latest retrieve "${guide.guideId}"`,
      }))
    )
  )
  const accepted = (f) => ACCEPTED.find((a) => a.guide === f.guide && a.file === f.file)
  const open = all.filter((f) => !accepted(f))

  for (const f of all.filter(accepted)) {
    console.log(`  [accepted] ${f.guide}: ${f.file}:${f.line} — ${accepted(f).reason}`)
  }
  for (const a of ACCEPTED) {
    if (!all.some((f) => f.guide === a.guide && f.file === a.file)) {
      warn('legacy-scan', `ACCEPTED entry ${a.guide} in ${a.file} no longer matches a finding; remove it`)
    }
  }
  for (const f of open) {
    note(`legacy-scan ${f.guide}`, `${f.file}:${f.line} — ${f.message}`, f.lineContent?.trim(), `guide: ${f.retrieve}`)
  }

  const scope =
    `${report.activeRuleCount} rules from ${report.activeGuideCount} guides` +
    (report.skippedDocsAndTestsCount ? `, ${report.skippedDocsAndTestsCount} docs/tests skipped` : '')
  if (open.length === 0) ok('legacy-scan', `0 open findings (${scope})`)
  else console.log(`  ${open.length} open finding(s) (${scope})`)
}

// ---------------------------------------------------------------- main

function main() {
  console.log('Modern Web Guidance — repository check\n')
  console.log('Agent skills (.agents/skills, skills-lock.json)')
  checkSkills()
  console.log('\nProject config (.mwgrc)')
  checkMwgrc()
  console.log('\nLegacy web-platform patterns (legacy-scan)')
  checkLegacyScan()

  console.log(`\n${'='.repeat(60)}`)
  console.log(findings.length ? `FAIL ${findings.length} finding(s)` : 'PASS 0 findings')
  process.exit(findings.length ? 1 : 0)
}

try {
  main()
} catch (e) {
  console.error('\nCheck crashed:', e)
  process.exit(2)
}
