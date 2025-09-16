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

Comparison with Notebook
- `solver.js`: Node-friendly module mirroring the scoring and solving logic from `app.js` (no DOM).
- `node_solver_cli.js`: CLI that reads JSON via stdin and prints the JS solution to stdout.
- `ayto_compare.py`: Python helpers that implement the original scoring/solving and compare the results with the Node/JS output.

How to compare inside the notebook
1. Ensure you open this folder in your notebook environment so it can access the local files.
2. Add a cell to install SciPy (optional; the code falls back to greedy if missing):

```python
!pip install scipy
```

3. Add a Python cell that loads the CSV, runs the Python reference implementation and the Node/JS implementation, and compares them:

```python
from ayto_compare import load_csv_rows, filter_people, solve_pairs, run_node_cli, compare_results

# Load your CSV
rows = load_csv_rows('test_form.csv')  # or your path

# Apply optional filter (match UI's Filter Column + Value)
filter_column = ''    # e.g. 'Will you come?'
filter_value = ''     # e.g. 'Yes'
people = filter_people(rows, filter_column, filter_value)

options = {'filterColumn': filter_column}

# Python reference (equivalent to the original notebook's logic)
py_res = solve_pairs(people, options)

# Node/JS (uses solver.js + hungarian.js, same as the web app)
node_res = run_node_cli(people, options)

# Compare
cmp = compare_results(py_res, node_res)
cmp
```

4. You should see whether names and matrix dimensions match, the maximum absolute difference across matrix entries, and whether the final pairs are identical.

Privacy
- Everything runs locally in your browser; no backend or uploads.

Limitations
- Greedy solver may be suboptimal for large groups.
- Requires an even number of participants after filtering.

