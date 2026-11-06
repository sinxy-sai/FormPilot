# Architecture

FormPilot is a local AI universal web runtime. The browser extension keeps the reviewable loop on the user's device:

1. The Side Panel imports a structured resume and asks the content runtime to inspect the current page.
2. The page model reports visible controls, labels, roles, options, section state, diagnostics, and a structure fingerprint. It does not contain arbitrary executable selectors or unnecessary personal values.
3. Deterministic matching and an optional local model propose tool-schema actions. Model output cannot call `chrome.*`, run JavaScript, or bypass the action guard.
4. Every proposed action is reviewed, checked against the current page identity, executed through a small control capability, then read back and verified. Failures remain explicit (`manual`, `skipped`, or `failed`) and can be retried or undone.

## System overview

```mermaid
flowchart TB
  subgraph PANEL["Side Panel — extension page"]
    P1["Resume JSON editor"]
    P2["Page card: inspect · backup · restore"]
    P3["Review table: field · current · target · status"]
    P4["Settings: language + theme"]
  end

  subgraph BG["Background service worker"]
    B1["Message router"]
    B2["Fill loop: snapshot → inspect → plan → execute → aggregate"]
    B3["Page backups (last 5 kept)"]
  end

  subgraph CS["Content script — page context"]
    C1["page-inspector"]
    C2["resume-index"]
    C3["matcher"]
    C4["action-guard"]
    C5["control-executor + capabilities"]
    C6["result-verifier"]
  end

  AI["Optional local AI worker<br/>proposals only, off by default"]
  DB[("chrome.storage.local<br/>resume · prefs · backups · strategy cache")]

  P1 --> B1
  P2 --> B1
  P3 --> B1
  P4 --> DB
  B1 --> B2
  B2 -->|"inspect"| C1
  B2 -->|"plan"| C2
  C2 --> C3
  C3 -->|"steps"| C4
  C4 --> C5
  C5 -->|"write + verify"| C6
  C6 -->|"results"| B2
  B2 --> B3
  B3 --> DB
  C3 -.->|"optional hints"| AI
```

`page-inspector` turns the live DOM into a **PageModel**: every control keeps its capability, section key, repeatable item index, and a structure fingerprint. `resume-index` turns the user's JSON into a **ResumeIndex**. `matcher` is deterministic and produces the step list; the optional local model may only contribute hints that are validated against those two models before use. Nothing downstream of `action-guard` can click, type into, or read outside the controls the PageModel already contains.

## One fill run

```mermaid
sequenceDiagram
  participant P as Side Panel
  participant B as Background
  participant C as Content script
  participant D as Page DOM
  P->>B: fill/run (tabId, resume, mode)
  B->>C: page/inspect
  C-->>B: PageModel + fingerprint
  B->>B: snapshot + planFill → steps
  B->>C: page/execute (steps, fingerprint)
  C->>C: action-guard
  C->>D: write control values
  C->>D: read back
  C-->>B: per-step result
  B-->>P: summary + backup reference
  Note over C,D: Save / Submit / Delete are never clicked
```

Each step re-inspects before it plans again, so a page that changes mid-run invalidates the stale plan instead of writing into shifted controls.


## Extension points

The primary extension unit is a **control capability**, not a complete site adapter. Capabilities cover reusable interaction patterns such as:

- text fields
- native selects
- custom comboboxes
- repeatable sections
- date pickers
- iframe or Shadow DOM access when the browser grants it

A validated strategy cache may contribute stable hints, but hints remain candidates until the current page fingerprint and capability versions match.

The strategy cache stores:

- locating and interaction experience
- capability versions
- provenance
- success counts
- invalidation reasons

It never stores sensitive field values. Navigation, refresh, document identity, or a structure fingerprint change invalidates the old task and cached strategy.

## Local AI boundary

No cloud multimodal model is required. A local text model may help with:

- semantic matching
- planning
- recovery

Local screenshot understanding is optional and stays on-device. When a local model is unavailable, deterministic matching, reusable control capabilities, and manual review still complete the safe parts of the workflow.

The final Submit button, CAPTCHA, login restrictions, destructive operations, and actions without an observable result have no automatic path. Cross-origin frames and closed Shadow DOM remain permission and browser capability boundaries.
