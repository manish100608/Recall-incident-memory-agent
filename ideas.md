# Recall — design brief

## Direction

**Chosen direction:** clean dark on-call operations dashboard, as specified by the user. Product scenario: an internal tool for engineers diagnosing production incidents. Design for rapid scanning under pressure, not marketing imagery.

## Design dimensions

- **Design movement:** contemporary observability tooling with restrained editorial clarity; avoid sci-fi, gaming, or generic admin-template styling.
- **Core principles:** evidence first; make uncertainty explicit; keep the current incident visually dominant; distinguish observed facts, hypotheses, recommendations, and historical memory; never visually imply an action was executed.
- **Color philosophy:** deep ink/navy surfaces, slightly lighter slate cards, cool neutral text, muted blue/cyan memory accents, amber for warnings/older evidence, red only for critical severity, and green only for resolved outcomes. Maintain readable contrast; avoid gradients, neon glow, and large color washes.
- **Layout paradigm:** desktop three-column investigation workspace (incident queue, active investigation, similar-memory evidence) with compact persistent header and clear switcher for Investigation, Memory Timeline, and Evaluation. Reflow into a single-column stack on narrow screens.
- **Signature elements:** compact severity chips; precise metric cards; monospaced, expandable log excerpts; confidence pill; cited incident IDs; explicit “With Hindsight memory” treatment; struck-through superseded beliefs; the recommendations-only banner.
- **Interaction philosophy:** deterministic and reversible controls; selection updates details; loading and error states stay in the relevant panel; destructive demo reset requires a clear confirmation naming the configured Hindsight bank; show provider errors rather than plausible-looking substitute answers.
- **Animation:** minimal 120–180 ms transitions for panel changes and loading indicators; no motion that delays critical information; honor reduced-motion preference.
- **Typography system:** system sans-serif for labels/body; tabular numerals for metrics; system monospace for IDs, deploy versions, and log lines. Use short readable line lengths and clear numeric alignment.
- **Brand essence:** calm operational memory—an engineer’s experience made searchable, while the human remains in control.
- **Brand voice:** direct, evidence-linked, concise, candid about confidence and missing history. Avoid certainty when the evidence is weak.
- **Wordmark/logo:** “Recall” wordmark in text plus a separate simple flat memory-loop mark; the mark should remain recognizable as a favicon and 24–48 px icon.
- **Signature brand color:** cool cyan/mint against deep navy, used selectively for memory evidence rather than for alert severity.
