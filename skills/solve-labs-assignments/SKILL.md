---
name: solve-labs-assignments
description: Solve academic labs, homework, exercises, problem sets, and assignments from provided files or instructions. Use when the user asks to complete a lab, TD, TP, homework, assignment, or its report, including numerical analysis, mathematics, programming, and similar coursework. Work through the questions, run required code, verify answers, and prepare requested deliverables with natural student prose and real screenshots.
---

# Solve labs and assignments

Complete the assigned work, including the solutions, required code, checks and requested submission files. For a lab report, default to an editable LaTeX source bundle and a visually checked PDF with real screenshots. Respect other requested formats; a short exercise answered in chat does not require a PDF. The user's preferred style is concise, natural student writing supported by actual work. New assignment instructions and explicit preferences take precedence over these defaults.

## When to use this skill

Apply it to requests such as “do this lab,” “solve this assignment,” “complete this TD/TP,” “help me with this homework,” and “write the report for these exercises.” Also apply it to revisions of those deliverables. Solving the questions is part of the task: do not stop at a plan, outline or report shell. If the user asks for hints, explanations or review rather than a complete solution, follow that narrower request.

Identify the submission requirements before choosing deliverables. A mathematics problem set may need derivations; a programming assignment may need source files and execution output; a computational lab may need both plus a report. Do not add screenshots to purely analytical work that has no relevant code or software output.

## Find the right assignment

- Search the given folder first. If no folder is specified, look narrowly in likely academic folders and Downloads before expanding the search. Find both the assignment and any previous report the user mentions.
- When several lab sheets are plausible, ask which one; inspect the earlier report and prepare the environment while waiting. Do not solve an arbitrary lab based only on its filename or modification date.
- Read every exercise and subquestion, including mathematical notation in scanned pages. Keep a working coverage check outside the submitted report.
- Follow the assignment's language and required software. For MATLAB assignments, prefer MATLAB when available; disclose a substitute if needed.

## Solve and run

- Complete the derivations and implementations before reporting results. Execute the code; do not invent outputs or illustrate a run that never occurred.
- State starting values, tolerances, stopping conditions and iteration-count conventions where they affect the interpretation. For random experiments, fix and record the seed.
- Check results against the original equations, independent calculations or exact solutions where practical. Check failures, sensitivity to starting values and convergence behavior when the lab asks for them.
- Keep the code that produced the results. A shorter file prepared for a screenshot must retain the same computations; verify it if its logic changes.

## Write like a student explaining the work

Read [references/writing-style.md](references/writing-style.md) before drafting or revising prose.

- Explain what was calculated, what happened, and why the result makes sense in connected paragraphs. Prefer concrete observations from the run to generic textbook summaries.
- Use first person sparingly where it reads naturally. Do not fabricate feelings, mistakes, experiments, or personal experiences.
- Include the mathematical reasoning needed to answer the questions, but omit generic introductions, objectives, abstract, decorative cover page, repeated summaries and filler conclusions unless the assignment requires them.
- Keep headings tied to exercises or necessary code/result groups. Use brief captions; the application frame already shows that an image is a screenshot.
- Do not add a bibliography or informational asides by default. Preserve attribution that the assignment requires or that is necessary for externally sourced material.

## Include actual screenshots

For computational lab reports, screenshots are part of this user's preferred deliverable: include the code, numerical output and graphs that matter to the assignment. For other assignments, include them when requested or when they provide useful evidence of execution; do not invent unnecessary software work just to obtain screenshots.

- Use the available computer-use tools to capture real editor, console and figure windows. A syntax-highlighted LaTeX listing or exported plot alone does not satisfy a screenshot request.
- Show the actual code and executed results. Never fabricate application chrome or render text to resemble a console screenshot.
- Crop irrelevant whitespace when useful, retaining enough application context and every relevant line, axis and legend. Keep the original captures in the source bundle.
- Read [references/screenshot-workflow.md](references/screenshot-workflow.md) when capturing screenshots, particularly in MATLAB.

## Build and inspect

Use [assets/report-template.tex](assets/report-template.tex) as a lightweight starting point when no existing LaTeX source is being revised. Adapt the layout to the assignment; do not impose a fixed page count.

- Keep the final report focused on answers, derivations, evidence and short observations. Place screenshots near their discussion or in compact code/result pages when that is more readable.
- Compile with the available LaTeX engine. Resolve errors and visible overflow.
- Render the final PDF to images and inspect every page. Check screenshot legibility at page size, unclipped code, complete captions, page breaks, tables and mathematical symbols. A successful compilation is not sufficient.
- If a PDF skill is available, follow its applicable build and verification requirements.
- Deliver the required submission files. For a PDF report, also provide a ZIP containing the LaTeX source, required images and runnable code. Use relative asset paths so the bundle can be moved. Keep build logs and intermediate renders outside the deliverables.

## Handle revisions narrowly

When the user requests only a change in prose, preserve the mathematics, results, code and screenshots. Compare the equations, tables and image references before and after editing, then rebuild and inspect the PDF. When screenshots are requested after an initial draft, capture and integrate them instead of resending exported plots.

Save revisions consistently and provide a clear link to the latest PDF and updated source bundle. Do not upload or submit the assignment externally unless separately instructed.
