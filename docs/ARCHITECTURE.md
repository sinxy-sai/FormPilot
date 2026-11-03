# Architecture

FormPilot is a local AI universal web runtime. The browser extension keeps the reviewable loop on the user’s device:

1. The Side Panel imports a structured resume and asks the content runtime to inspect the current page.
2. The page model reports visible controls, labels, roles, options, section state, diagnostics, and a structure fingerprint. It does not contain arbitrary executable selectors or unnecessary personal values.
3. Deterministic matching and an optional local model propose tool-schema actions. Model output cannot call `chrome.*`, run JavaScript, or bypass the action guard.
4. Every proposed action is reviewed, checked against the current page identity, executed through a small control capability, then read back and verified. Failures remain explicit (`manual`, `skipped`, or `failed`) and can be retried or undone.

## Extension points

<<<<<<< HEAD
The primary extension unit is a **control capability**, not a complete site adapter. Capabilities cover reusable interaction patterns such as text fields, native selects, custom comboboxes, repeatable sections, date pickers, and iframe or Shadow DOM access when the browser grants it. A site-specific strategy may contribute stable hints, but it is cached only after successful validation and remains a candidate until the current page fingerprint matches.
=======
The primary extension unit is a **control capability**, not a complete site adapter. Capabilities cover reusable interaction patterns such as text fields, native selects, custom comboboxes, repeatable sections, date pickers, and iframe or Shadow DOM access when the browser grants it. A validated strategy cache may contribute stable hints, but hints remain candidates until the current page fingerprint and capability versions match.
>>>>>>> 2952a65

The strategy cache stores locating and interaction experience, capability versions, provenance, success counts, and invalidation reasons. It never stores sensitive field values. Navigation, refresh, document identity, or a structure fingerprint change invalidates the old task and cached strategy.

## Local AI boundary

No cloud multimodal model is required. A local text model may help with semantic matching, planning, and recovery. Local screenshot understanding is optional and stays on-device. When a local model is unavailable, deterministic matching, reusable control capabilities, and manual review still complete the safe parts of the workflow.

The final Submit button, CAPTCHA, login restrictions, destructive operations, and actions without an observable result have no automatic path. Cross-origin frames and closed Shadow DOM remain permission and browser capability boundaries.

See the [design specification](superpowers/specs/2026-11-02-local-ai-universal-runtime-design.md) for the full data flow and safety model.
