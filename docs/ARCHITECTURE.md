# Architecture`n`nLaTeX/PDF is the presentation source. Structured JSON is the autofill source. Rules and saved user mappings run first; uncertain fields are edited or optionally sent to a semantic matcher.

## Dynamic and constrained controls

Application forms may hide controls until an Edit action, represent choices with native select controls, or implement custom searchable dropdowns. Native inputs and textareas can be filled directly; native selects are filled only when value or visible text matches an option. Hidden sections may be activated through a nearby Edit button. Custom dropdowns require a site adapter that opens, searches, selects, and verifies the resulting state. Missing permitted options are skipped with an option-not-found report.
