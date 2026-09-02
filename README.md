# scan-hub — Auranis

A single-file, browser-only security scanner. Open [`nullbreach.html`](nullbreach.html) — that's the whole product: no backend, no build step, no npm, no server. Your code never leaves the machine unless you scan a public repository over HTTPS.

## What it does

Four passes over a repository link (GitHub / GitLab / Bitbucket / `owner/repo`) or dropped files (any type, zip included):

1. **Leaked secrets** — Shannon entropy across every string literal + 40+ known secret signatures
2. **Risky patterns** — OWASP-style code smells
3. **Dependencies** — live OSV.dev CVE lookups (deps.dev mirror fallback) + look-alike / dependency-confusion package names
4. **AI summary (optional)** — plain-language explanation, logic-bug hunt, exploit walkthroughs

Verdict bands: **85–100 READY TO SHIP · 50–84 NEEDS FIXES · 0–49 BLOCKED** (any critical finding forces BLOCKED).

## Bring your own key — nothing embedded

- There are **no API keys anywhere in this repository**. Not in plaintext, not obfuscated. A pattern sweep (`gsk_` / `sk-` / `AIza` / `ghp_` / `AKIA` / bearer headers / hex & base64 blobs) is part of the release checklist.
- The AI pass works only if **you** add **your own** key in Preferences. Keys are stored in `localStorage` on your device and are sent **only** to the provider you chose. With zero keys the app degrades gracefully: everything except the AI summary still runs.
- The optional GitHub token in Settings is yours too; without it, anonymous GitHub limits (60 req/h) apply.

## Privacy

Scans of dropped files run entirely in your browser. Repository scans fetch publicly accessible files directly from the host. History (last 10 scans) is device-local and clearable. There is no telemetry — there is no server to phone home to.

## Run it

Open the file, or serve it:

```
python3 -m http.server 8080   # → http://localhost:8080/nullbreach.html
```

## Tests

Node-based harness (DOM shim, no browser): boot the file in a VM context, audit listener wiring, run a local drop scan end-to-end, a live GitHub scan, and assert the BYOK cascade makes **zero** network calls when no keys are configured.

## Repository scanning via CI

The `scripts/` + `.github/workflows/` folder is an independent path: open an issue with the scan template and the workflow runs Gitleaks/Semgrep/Trivy against the target repo. Unrelated to the browser app.
