Are You The One? Pair Finder (Static Web App)

Quick start
- Open `index.html` in a modern browser.
- Upload your Google Forms CSV.
- Configure the attendance filter if needed.
- Optionally set an optional participant or a forced removal to make the count even.
- Click "Calculate & Start Game" to begin guessing, then "Reveal" when ready.

CSV format tips
- Must contain `Name and surname` with unique names.
- If you set the filter, only rows where `filterColumn == filterValue` are kept.
- Compatibility uses all mostly-numeric columns; non-numeric values are ignored.
- Decimal commas are supported (e.g., "3,5" becomes 3.5).

Solver
- Default greedy matching on a similarity matrix (negative Euclidean distance).
- You can later include OR-Tools WASM and replace `runSolver` for optimal results.

Files
- `index.html`: UI structure
- `style.css`: styles
- `app.js`: CSV parsing, filtering, compatibility, solver, game, reveal

Privacy
- Everything runs locally in your browser; no backend or uploads.

Limitations
- Greedy solver may be suboptimal for large groups.
- Requires an even number of participants after filtering.

