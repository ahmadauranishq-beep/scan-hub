#!/usr/bin/env node
/**
 * NULLBREACH CI runner — scans a local repository with the exact same engine
 * that powers nullbreach.html (extracted from the single-file app at runtime,
 * so there is ONE source of truth for signatures, entropy and scoring).
 *
 * Usage:
 *   node scripts/nullbreach-ci.mjs [targetDir] [--out dir]
 *
 * Environment (all optional):
 *   GROQ_API_KEY / GEMINI_API_KEY / MISTRAL_API_KEY / ANTHROPIC_API_KEY / OPENAI_API_KEY
 *       → enables the AI reasoning layer in CI (your keys, max priority)
 *   NULLBREACH_ALLOW_CORE=1
 *       → also allow the embedded Core Engine keys (disabled in CI by default
 *         to protect the shared quota)
 *   NULLBREACH_FAIL_ON_CRITICAL=1
 *       → exit with code 1 when any CRITICAL finding is present (security gate)
 *   NULLBREACH_MAX_FILES=500
 *
 * No dependencies. Requires Node 18+ (built-in fetch).
 */
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const APP_FILE = path.resolve(import.meta.dirname, '..', 'nullbreach.html');

/* ---------- load the engine out of the single-file app ---------- */
function extractBlock(html, start, end) {
  const a = html.indexOf(start), b = html.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error('engine markers missing in nullbreach.html');
  return html.slice(a + start.length, b);
}
const html = fs.readFileSync(APP_FILE, 'utf8');
let engineSrc =
  extractBlock(html, '/*ENGINE-START*/', '/*ENGINE-END*/') +
  extractBlock(html, '/*ENGINE-START2*/', '/*ENGINE-END2*/') +
  extractBlock(html, "<script id=\"nb-orchestration\">\n", '</script>');

/* CI guard: keep the embedded Core Engine off unless explicitly allowed (shared quota) */
engineSrc = engineSrc.replace(
  'const allowCore = (typeof globalThis.NB_CORE_ENABLED === \'undefined\') || globalThis.NB_CORE_ENABLED !== false;',
  'const allowCore = globalThis.NB_CORE_ENABLED === true;'
);

/* minimal browser stubs — every engine function guards its DOM access */
const elStub = () => ({
  classList: { add() {}, remove() {}, contains() { return false; } },
  style: {}, dataset: {}, value: '', innerHTML: '', textContent: '', checked: true,
  appendChild() {}, removeChild() {}, addEventListener() {}, querySelectorAll() { return []; },
  querySelector() { return null; }, scrollTop: 0, scrollHeight: 0
});
const g = globalThis;
g.window = { innerWidth: 0, innerHeight: 0, addEventListener() {}, atob: (s) => Buffer.from(s, 'base64').toString('binary') };
g.document = { getElementById: () => elStub(), querySelectorAll: () => [], querySelector: () => null, addEventListener() {}, createElement: () => elStub(), body: elStub() };
g.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
g.requestAnimationFrame = (fn) => fn(0);
g.showToast = () => {};
g.lucide = { createIcons() {} };

const engine = new Function(engineSrc + `
  return { SIGNATURES, scanEntropyInFile, scanFileStatic, parseManifests, queryOSV,
           computeScore, verdictFor, buildAIContext, buildAIPrompt, parseAIFindings,
           runAICascade, state, isRelevantFile, isLowTrustPath, prioritizeFiles,
           sevOrder, NB_VERSION };
`)();

/* ---------- CLI args ---------- */
const argv = process.argv.slice(2);
let target = process.cwd();
let outDir = null;
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--out') outDir = argv[++i];
  else target = path.resolve(argv[i]);
}
if (!outDir) outDir = target;
const MAX_FILES = parseInt(process.env.NULLBREACH_MAX_FILES || '800', 10);

const log = (m) => console.log(`\x1b[38;5;121m[nullbreach]\x1b[0m ${m}`);

/* ---------- collect files (same filters as the browser app) ---------- */
function walk(dir, base, acc) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (acc.length >= 20000) return;
    const full = path.join(dir, e.name);
    const rel = path.relative(base, full).split(path.sep).join('/');
    if (e.isDirectory()) {
      if (/^(node_modules|\.git|vendor|dist|build|out|coverage|__pycache__|\.venv|venv|target|\.next|\.idea|\.vscode|site-packages)$/i.test(e.name)) continue;
      walk(full, base, acc);
    } else if (e.isFile()) {
      let size = 0;
      try { size = fs.statSync(full).size; } catch { continue; }
      if (engine.isRelevantFile(rel, size)) acc.push({ path: rel, full });
    }
  }
}
const candidates = [];
walk(target, target, candidates);
const chosen = engine.prioritizeFiles(candidates, MAX_FILES);
log(`engine v${engine.NB_VERSION} · ${engine.SIGNATURES.length} signatures · ${candidates.length} relevant files → scanning ${chosen.length}${chosen.length < candidates.length ? ` (capped from ${candidates.length})` : ''}`);

const files = [];
for (const c of chosen) {
  try {
    const content = fs.readFileSync(c.full, 'utf8');
    if (content.length <= 500000) files.push({ path: c.path, content });
  } catch { /* unreadable — skip */ }
}
if (!files.length) { log('no scannable files found — nothing to do'); process.exit(0); }

/* ---------- layer 1 + 2 ---------- */
let findings = [];
let stringsTotal = 0;
for (const f of files) {
  const r = engine.scanEntropyInFile(f);
  findings.push(...r.findings);
  stringsTotal += r.stringsChecked;
}
log(`layer 1 (entropy): ${stringsTotal} strings tested → ${findings.length} flags`);
let patternCount = 0;
for (const f of files) {
  const pf = engine.scanFileStatic(f);
  findings.push(...pf);
  patternCount += pf.length;
}
log(`layer 2 (signatures): ${patternCount} matches`);

/* ---------- layer 3: OSV.dev (live) ---------- */
const manifestFiles = files.filter(f => /package\.json$|requirements[\w.-]*\.txt$|requirements\.in$|go\.mod$|Gemfile\.lock$/.test(f.path));
const deps = engine.parseManifests(manifestFiles);
let osvCount = 0;
if (deps.length) {
  log(`layer 3 (OSV.dev): querying ${deps.length} pinned dependencies…`);
  try {
    const osv = await engine.queryOSV(deps);
    findings.push(...osv.findings);
    osvCount = osv.findings.length;
    log(`layer 3 (OSV.dev): ${osv.queried} packages checked → ${osvCount} published advisories`);
  } catch (e) {
    log(`layer 3 (OSV.dev): UNAVAILABLE (${String(e.message).slice(0, 120)}) — continuing without CVE data`);
  }
} else {
  log('layer 3 (OSV.dev): no supported manifests with pinned versions found');
}

/* ---------- dedupe + score ---------- */
const seen = new Set();
findings = findings.filter(f => {
  const k = f.sig + '|' + f.file + '|' + f.line + '|' + f.name;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});
findings.sort((a, b) => engine.sevOrder(a.severity) - engine.sevOrder(b.severity) || a.file.localeCompare(b.file));

/* ---------- optional AI layer (your env keys, max priority) ---------- */
const envKeys = [
  ['groq', process.env.GROQ_API_KEY], ['gemini', process.env.GEMINI_API_KEY],
  ['mistral', process.env.MISTRAL_API_KEY], ['claude', process.env.ANTHROPIC_API_KEY],
  ['openai', process.env.OPENAI_API_KEY]
];
engine.state.userKeys = envKeys.filter(([p, k]) => k).map(([p, k]) => ({ id: 'env_' + p, provider: p, key: k }));
let ai = { text: null, provider: null, usedBuiltin: false, failures: ['ai disabled'] };
if (engine.state.userKeys.length || process.env.NULLBREACH_ALLOW_CORE === '1') {
  if (process.env.NULLBREACH_ALLOW_CORE === '1') g.NB_CORE_ENABLED = true;
  log(`AI layer: ${engine.state.userKeys.length} env key(s)${g.NB_CORE_ENABLED ? ' + Core Engine' : ''} — running semantic review…`);
  const context = engine.buildAIContext(files, findings);
  const prompt = engine.buildAIPrompt(
    { owner: 'local', name: path.basename(target), branch: 'ci', score: engine.computeScore(findings).score, counts: engine.computeScore(findings).counts, filesScanned: files.length },
    findings, context
  );
  try {
    ai = await engine.runAICascade(prompt);
    log(`AI layer: ${ai.text ? 'complete via ' + ai.provider : 'unavailable (' + ai.failures.join('; ').slice(0, 120) + ')'}`);
    if (ai.text) {
      const af = engine.parseAIFindings(ai.text);
      for (const f of af) findings.push(f);
    }
  } catch (e) {
    log(`AI layer failed: ${String(e.message).slice(0, 140)}`);
  }
} else {
  log('AI layer: skipped (no env keys — set GROQ_API_KEY etc. to enable; static + OSV results are complete)');
}

/* ---------- final score ---------- */
const rescored = engine.computeScore(findings);
const verdict = engine.verdictFor(rescored.score, rescored.counts);
const C = rescored.counts;
log('──────────────────────────────────────────────');
log(`SCORE: ${rescored.score}/100 · verdict: ${verdict}`);
log(`critical: ${C.critical} · high: ${C.high} · medium: ${C.medium} · low: ${C.low} · exploit-CVEs: ${rescored.exploitHits}`);
for (const f of findings.slice(0, 40)) {
  const loc = f.line ? `${f.file}:${f.line}` : f.file;
  const tag = (f.cveId || f.osvId || f.cwe || '').toString();
  console.log(`  ${f.severity.toUpperCase().padEnd(8)} [${f.layer}] ${loc} — ${f.name}${tag ? ' · ' + tag : ''}`);
}
if (findings.length > 40) log(`… and ${findings.length - 40} more (see report files)`);

/* ---------- reports ---------- */
fs.mkdirSync(outDir, { recursive: true });
const report = {
  tool: 'NULLBREACH CI', version: engine.NB_VERSION,
  generatedAt: new Date().toISOString(),
  target: path.basename(target),
  score: rescored.score, verdict, counts: C, exploitHits: rescored.exploitHits,
  stats: { filesScanned: files.length, stringsChecked: stringsTotal, signatures: engine.SIGNATURES.length, depsQueried: deps.length },
  ai: ai.text ? { provider: ai.provider, usedBuiltin: !!ai.usedBuiltin } : { unavailable: true },
  findings
};
fs.writeFileSync(path.join(outDir, 'nullbreach-report.json'), JSON.stringify(report, null, 2));
const md = ['# NULLBREACH CI Report — ' + path.basename(target), '',
  `**Score:** ${rescored.score}/100 · **Verdict:** ${verdict} · **Generated:** ${report.generatedAt}`, '',
  `Formula: 100 − 20×${C.critical} − 12×${C.high} − 5×${C.medium} − 2×${C.low}${rescored.exploitHits ? ` − 10×${rescored.exploitHits}` : ''}`, '',
  '| Severity | Count |', '| --- | --- |',
  `| Critical | ${C.critical} |`, `| High | ${C.high} |`, `| Medium | ${C.medium} |`, `| Low | ${C.low} |`, '',
  '## Findings', '',
  ...findings.map(f => {
    const loc = f.line ? `${f.file}:${f.line}` : f.file;
    const id = f.cveId || f.osvId || f.cwe || '';
    return `- **[${f.severity.toUpperCase()}]** ${f.name} — \`${loc}\` (${f.layer}${id ? ' · ' + id : ''})\n  - ${String(f.desc).replace(/\n/g, ' ')}\n  - *Fix:* ${String(f.remed).replace(/\n/g, ' ')}`;
  }), '',
  '---',
  'NULLBREACH combines entropy-based secret detection, a 40+ signature pattern library, real CVE data from OSV.dev, and AI semantic analysis. It is a strong first-pass triage tool but not a certified replacement for a full professional security audit. Always verify critical findings before acting.'
].join('\n');
fs.writeFileSync(path.join(outDir, 'nullbreach-report.md'), md);
log(`reports written: ${path.join(outDir, 'nullbreach-report.json')} + .md`);

/* ---------- security gate ---------- */
if (process.env.NULLBREACH_FAIL_ON_CRITICAL === '1' && C.critical > 0) {
  log(`GATE: FAIL — ${C.critical} critical finding(s) (NULLBREACH_FAIL_ON_CRITICAL=1)`);
  process.exit(1);
}
log('GATE: pass' + (C.critical ? ` (gate disabled — set NULLBREACH_FAIL_ON_CRITICAL=1 to enforce)` : ''));
process.exit(0);
