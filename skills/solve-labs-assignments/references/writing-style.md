# Approved writing style

The user approved a concise English numerical-analysis report after asking for two corrections: actual application screenshots, including code, and prose that sounded less mechanical. The preference is for a student explaining calculations clearly, not a formal research article or a checklist converted into sentences.

## Prose

Build paragraphs around the calculation or observation. Connect the reasoning instead of repeatedly announcing a method, stating a result, and adding a generic conclusion. Vary sentence openings naturally; replacing every sentence with “I used…” is still mechanical.

Use ordinary, precise language. Keep technical terms where they do real work: residual, Jacobian, tolerance, quadratic convergence. Avoid inflated language, stock transitions and claims such as “demonstrating the effectiveness of the method.” Do not add deliberate errors or slang to imitate a student.

Examples adapted from the approved report:

- Rather than “The results demonstrate the superiority of Newton's method,” write: “Newton needed 4 steps, compared with 6 for secant and 37 for fixed-point iteration.” Distinguish iteration count from measured runtime.
- Rather than “Sensitivity to initial conditions was observed,” write: “With the second formula, starts at 0.6 and 0.7 went to different roots.” Explain the relevant derivative condition after or before that observation.
- Rather than “The algorithm successfully converged despite initial nonmonotonic behavior,” write: “The residual first went up from 10 to about 506.4, then fell until the method stopped at step 9.”
- A derivation can read: “From the first two equations, … . Putting these into the third leaves … . The correction and the next point are then … .”

These are examples of voice, not facts or sentences to reuse in another assignment. Every number and claimed experiment must come from the current work.

## Captions and structure

Prefer “Convergence to the middle root,” “Newton solver,” or “Computed intersections and distance checks” to repeated labels such as “MATLAB screenshot of the numerical output produced by the implementation.”

Keep exercise headings, equations, tables and necessary explanations. Natural prose does not mean padding the document with narrative or deleting the mathematical reasoning. Do not add an abstract, objectives, sources section, conclusion or a personal name/date unless useful or required.

For a prose-only revision, leave verified calculations and screenshots intact. Read the paragraphs as connected prose before recompiling, then check the changed page layout.
