# Real application screenshots

## Evidence and readability

Run the assignment code in the intended application. Capture editor views that include the relevant functions, console views with actual numerical results, and graph windows with visible axes and legends. Exported plots can supplement screenshots, but cannot replace them when screenshots are requested.

Keep raw screenshot files. Cropping in LaTeX is useful for removing large empty areas, but inspect the last code line, line numbers, axis labels and bottom console output after cropping. Never crop away an error or qualification that changes the result's meaning. Keep some editor/console/figure framing where practical so the evidence remains recognizable.

Save the same screenshot bytes that were inspected. Taking a second screenshot only to save it can capture a newly appeared tooltip, menu or cursor overlay. If a capture fails or returns no image, do not overwrite the last valid file.

## Using computer-use tools

Follow the current tool's initialization, observation and action instructions. Do not substitute shell-based UI automation for the authorized computer-use interface. Preserve the user's open files and work; a slow or empty application window alone is not a reason to quit the application.

After a timeout, inspect the UI before retrying. A paste may have succeeded even when the tool reports a clipboard timeout. Retrying blindly can duplicate commands or insert text into the wrong pane. Confirm focus and visible content before executing anything.

If pointer actions fail but keyboard input works, use supported keyboard navigation with fresh observations. An accessibility “Raise” action, when exposed, can restore focus. Do not invent unavailable UI APIs or selectors. Report a concrete blocker if the interface cannot be controlled; do not replace missing screenshots with fabricated ones.

## MATLAB notes from the successful workflow

In the macOS MATLAB desktop used for the original report, Command+0 focused the Command Window and Command+Shift+M expanded the active pane. These are observed shortcuts for that environment, not assumptions for every version or platform; check their effect.

The workflow was to run the main script, open the relevant `.m` files in the editor, and show the graph windows. Small display scripts printed selected results from the computed result structure so the console captures were readable. They did not invent or change the calculations.

Figures may open partly off-screen. Use an available window-centering action and recapture. Dismiss menus and tooltips before saving; an axes-toolbar tooltip can cover a legend even when the graph itself is correct.

Keep source files compact enough to read in a screenshot without shrinking the text excessively. If necessary, use several captures rather than cutting off part of a function. Do not change the user's persistent editor preferences merely to match the previous report's appearance.
