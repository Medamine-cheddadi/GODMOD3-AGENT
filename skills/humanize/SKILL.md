---
name: humanize
description: Write and rewrite prose top-down so it stops reading as AI-generated. The root problem this fixes is phrase-by-phrase generation — locally fluent sentences with no paragraph-level spine. The method forces a plan before the prose (point, reader takeaway, arc, per-sentence job), then structure-driven word choice, then a spine check; a secondary pass removes residual tells (formulaic frames, filler, LLM vocabulary, signposting, metronome rhythm). Default register is de-slopped textbook. Use when text sounds AI-generated or "slop", when composing explanatory or reference prose, or when asked to humanize, de-slop, or tighten. Preserves meaning and technical accuracy; never invents facts or fakes casualness.
---

# Humanize

Produce prose that reads as though a specific, competent person wrote it — because it was planned like one, not assembled token by token. This governs **how prose is composed**, not only how it is cleaned up afterward. Meaning, facts, numbers, and technical terms are preserved exactly; tone never overrides accuracy, and "sounding human" never licenses slang, invented anecdotes, or errors.

## The root problem

AI prose is built bottom-up. The model picks a locally fluent phrase, then another, then another — each acceptable in isolation, but the paragraph has no spine because nothing planned it. The result is a run of adjacent true statements that reads as assembled rather than thought. Human prose is built top-down: a point exists first, the paragraph takes a shape, and every sentence is chosen to move that shape forward. The fix is to write the second way.

## The method

Apply these three moves to every paragraph of real prose (skip for pure reference rows, code, and short labels).

### 1 · Plan the paragraph before writing a word

Settle, in one line each:
- **Point** — the single thing this paragraph asserts.
- **Takeaway** — what the reader should believe or be able to do after it.
- **Arc** — chosen deliberately, not defaulted: claim → mechanism → consequence; problem → cause → fix; observation → turn → payoff; general → specific → so-what.
- **Load-bearing sentence** — which one carries the weight. Build the rest around it.

If the point cannot be stated in one line, the paragraph is not ready to write.

### 2 · Generate top-down, not phrase-by-phrase

Before each sentence, ask *what does the reader need next to reach the point* — then write that, in the plainest words that carry it. Enforce:
- **One job per sentence** — state, complicate, prove, qualify, resolve. If two sentences do the same job, cut one.
- **Logic as the connector** — join sentences by cause, contrast, or consequence. Prefer *no* connective over an additive "and also / moreover / furthermore," which is the sound of having no structure.
- **Varied architecture** — change where the main clause sits and what gets subordinated, not merely sentence length. A run of same-shaped sentences reads mechanical even when each is fine.

### 3 · Check the spine

- State the paragraph's point in one sentence without rereading it. If you cannot, it has no spine — replan, do not polish.
- Remove any sentence. If nothing breaks, it was filler; leave it out.
- Ask whether the paragraph *builds* or merely *lists*. If it lists adjacent facts, either give it a spine or make it an actual list.

## Default register: de-slopped textbook

Unless the material or the user clearly wants otherwise, write in a measured, explanatory register — an author who understands the subject and respects the reader. Concretely: full sentences of varied length, careful qualification where it earns its place, precise terminology, and a calm authority that neither performs enthusiasm nor hedges. Adapt when the context demands it (a terse API note, a looser blog), but this is the house voice.

**Before (phrase-by-phrase):**
> The moves are constant across labs. What changes is the take-over step and how you read the answer, which is important. Sometimes data is printed, sometimes a yes or no, sometimes a delay — each is a different channel.

**After (planned, textbook):**
> The three moves never change from one lab to the next. What varies is smaller than it looks: how you take over the query, and what the application is willing to tell you back — the data itself, a bare yes-or-no, or nothing but a delay. Pin those two down and the lab stops being a puzzle; it turns into a lookup.

## Secondary pass — remove residual tells

Once the structure is sound, clear the surface signatures:
- **Formulaic frames** — "it's not just X, it's Y", "this isn't about X; it's about Y", rule-of-three padding, "whether you're a X or a Y", closing flourishes ("Ultimately,", "At the end of the day,").
- **Filler and hedging** — "it's worth noting", "that said", "needless to say", empty intensifiers (very, really, truly, incredibly).
- **LLM vocabulary** — delve, leverage, utilize, robust, seamless, elevate, unlock, streamline, realm, landscape, tapestry, testament to, "in today's fast-paced world", "a powerful tool".
- **Signposting** — "Let's dive in", "In this section", "As we can see", and first sentences that restate the heading.
- **Metronome rhythm** — em-dashes on a fixed cadence and identical paragraph lengths. Keep the few dashes that earn their place; vary the rest.

## Guardrails

- **Accuracy first.** If a truer sentence must stay slightly stiff, keep it true and say so rather than smoothing away the precision.
- **Structure is not slop.** Headings, lists, and tables are how people organize reference material too. Remove only *narrated* structure, not real structure.
- **Do not fake humanness.** No inserted slang, typos, forced contractions, or exclamation marks. Specificity and rhythm are what read as human, not affected looseness.
- **Preserve terminology.** Keep the author's names for things and any domain conventions.

## Output

Return the composed or rewritten prose. When the user asks what changed, or the edit was substantial, add a short list naming the few largest categories of change — never a line-by-line diff. If a passage is locked by accuracy and cannot improve without risking meaning, leave it and note why.
