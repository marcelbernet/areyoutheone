import csv
import json
import math
import subprocess
from typing import List, Dict, Any, Tuple

try:
    import numpy as np  # type: ignore
except Exception:  # pragma: no cover
    np = None  # type: ignore

try:
    from scipy.optimize import linear_sum_assignment  # type: ignore
except Exception:  # pragma: no cover
    linear_sum_assignment = None  # type: ignore

NameKey = 'Name and surname'


def extract_leading_integer(text: Any) -> float:
    s = str(text or '').strip()
    num = ''
    for ch in s:
        if ch.isdigit():
            num += ch
        else:
            break
    try:
        return float(num) if num else float('nan')
    except Exception:
        return float('nan')


def detect_question_type(column_name: str):
    s = str(column_name or '').strip()
    if not s:
        return None
    import re
    m = re.search(r"\(([ABC])\)\s*$", s, re.IGNORECASE)
    return m.group(1).upper() if m else None


def get_question_specs(people: List[Dict[str, Any]], attendance_column: str = ''):
    if not people:
        return []
    all_keys = list(people[0].keys())
    q_keys = []
    for k in all_keys:
        if k == NameKey:
            continue
        if attendance_column and k == attendance_column:
            continue
        t = detect_question_type(k)
        if t:
            q_keys.append(k)
    specs = []
    for key in q_keys:
        t = detect_question_type(key)
        min_v = math.inf
        max_v = -math.inf
        if t == 'B':
            for p in people:
                v = extract_leading_integer(p.get(key))
                if not math.isnan(v):
                    min_v = min(min_v, v)
                    max_v = max(max_v, v)
            if min_v == math.inf or max_v == -math.inf:
                min_v = 0
                max_v = 1
        specs.append({'key': key, 'type': t, 'minV': min_v, 'maxV': max_v})
    return specs


def score_answer_pair(a_num: float, b_num: float, type_: str, min_v: float = 0, max_v: float = 1) -> float:
    if type_ == 'A':
        return 1.0 if a_num == b_num else 0.0
    if type_ == 'B':
        denom = max(1.0, max_v)
        return 1.0 - (abs(a_num - b_num) / denom)
    if type_ == 'C':
        return 0.0 if a_num == b_num else 1.0
    return 0.0


def build_compatibility_matrix(people: List[Dict[str, Any]], options: Dict[str, Any] = None):
    options = options or {}
    specs = get_question_specs(people, options.get('filterColumn', ''))
    n = len(people)
    matrix = [[0.0 for _ in range(n)] for _ in range(n)]
    for i in range(n):
        for j in range(i + 1, n):
            points = 0.0
            for spec in specs:
                ai = extract_leading_integer(people[i].get(spec['key']))
                aj = extract_leading_integer(people[j].get(spec['key']))
                if math.isnan(ai) or math.isnan(aj):
                    continue
                points += score_answer_pair(ai, aj, spec['type'], spec['minV'], spec['maxV'])
            matrix[i][j] = points
            matrix[j][i] = points
    # Normalize: zero diagonal and non-negative entries
    min_val = math.inf
    for i in range(n):
        for j in range(n):
            if i == j:
                continue
            v = float(matrix[i][j] or 0.0)
            if v < min_val:
                min_val = v
    if min_val == math.inf:
        min_val = 0.0
    if min_val < 0:
        shift = -min_val
        for i in range(n):
            for j in range(n):
                if i == j:
                    matrix[i][j] = 0.0
                else:
                    matrix[i][j] = max(0.0, float(matrix[i][j] or 0.0) + shift)
    else:
        for i in range(n):
            matrix[i][i] = 0.0
    return matrix


def greedy_pairing(matrix: List[List[float]]):
    n = len(matrix)
    used = [False] * n
    pairs = []
    for i in range(n):
        if used[i]:
            continue
        best_j = -1
        best_score = -1e100
        for j in range(n):
            if i == j or used[j]:
                continue
            if matrix[i][j] > best_score:
                best_score = matrix[i][j]
                best_j = j
        if best_j == -1:
            continue
        used[i] = True
        used[best_j] = True
        pairs.append((i, best_j))
    return pairs


def run_solver(matrix: List[List[float]]):
    n = len(matrix)
    if n % 2 != 0:
        raise ValueError('Participants must be even')
    half = n // 2
    if n < 2 or half == 0:
        # Nothing to pair
        return []
    left_idx = list(range(half))
    right_idx = list(range(half, n))
    # Build cost matrix from negative scores
    cost = [[-matrix[i][j] for j in right_idx] for i in left_idx]
    if linear_sum_assignment is not None and np is not None:
        cost_np = np.array(cost, dtype=float)
        # Ensure 2-D shape for SciPy
        if cost_np.ndim == 2 and cost_np.size > 0:
            row_ind, col_ind = linear_sum_assignment(cost_np)
            pairs = [(left_idx[i], right_idx[j]) for i, j in zip(row_ind.tolist(), col_ind.tolist())]
            return pairs
    # Fallback greedy
    return greedy_pairing(matrix)


def solve_pairs(people: List[Dict[str, Any]], options: Dict[str, Any] = None):
    options = options or {}
    matrix = build_compatibility_matrix(people, options)
    idx_pairs = run_solver(matrix)
    pairs_by_name = []
    for i, j in idx_pairs:
        a = str(people[i].get(NameKey, '')).strip()
        b = str(people[j].get(NameKey, '')).strip()
        pair = sorted([a, b])
        pairs_by_name.append(pair)
    pairs_by_name.sort(key=lambda x: x[0])
    names = [str(p.get(NameKey, '')).strip() for p in people]
    return {
        'names': names,
        'matrix': matrix,
        'pairs': pairs_by_name,
        'indexPairs': idx_pairs,
    }


def load_csv_rows(csv_path: str) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    with open(csv_path, 'r', encoding='utf-8') as f:
        sample = f.read(4096)
        f.seek(0)
        dialect = None
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=[',', ';', '\t'])
        except Exception:
            # Fallback to semicolon which is common for exported CSVs
            class _Semi(csv.Dialect):
                delimiter = ';'
                quotechar = '"'
                doublequote = True
                skipinitialspace = False
                lineterminator = '\n'
                quoting = csv.QUOTE_MINIMAL
            dialect = _Semi
        reader = csv.DictReader(f, dialect=dialect)
        for row in reader:
            # Trim keys and values similar to app.js
            cleaned = {}
            for k, v in row.items():
                key = (k or '').strip()
                cleaned[key] = v.strip() if isinstance(v, str) else v
            rows.append(cleaned)
    return rows


def filter_people(rows: List[Dict[str, Any]], filter_column: str = '', filter_value: str = ''):
    if not filter_column or not filter_value:
        return rows
    return [r for r in rows if str(r.get(filter_column, '')).strip() == str(filter_value).strip()]


def run_node_cli(people: List[Dict[str, Any]], options: Dict[str, Any] = None) -> Dict[str, Any]:
    options = options or {}
    payload = json.dumps({'people': people, 'options': options})
    proc = subprocess.run(
        ['node', 'node_solver_cli.js'],
        input=payload.encode('utf-8'),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd='.',
        check=False,
    )
    if proc.returncode != 0:
        raise RuntimeError(f'Node CLI failed: {proc.stderr.decode("utf-8", "ignore")}')
    return json.loads(proc.stdout.decode('utf-8'))


def compare_results(py_res: Dict[str, Any], node_res: Dict[str, Any]) -> Dict[str, Any]:
    # Compare names order
    names_equal = py_res['names'] == node_res['names']
    # Compare matrix dimensions and numeric closeness
    py_m = py_res['matrix']
    nd_m = node_res['matrix']
    dims_equal = (len(py_m) == len(nd_m)) and all(len(r1) == len(r2) for r1, r2 in zip(py_m, nd_m))
    max_diff = 0.0
    if dims_equal:
        n = len(py_m)
        for i in range(n):
            for j in range(n):
                d = abs(float(py_m[i][j]) - float(nd_m[i][j]))
                if d > max_diff:
                    max_diff = d
    # Compare pairs as sets of tuples
    py_pairs = [tuple(p) for p in py_res['pairs']]
    nd_pairs = [tuple(p) for p in node_res['pairs']]
    pairs_equal = sorted(py_pairs) == sorted(nd_pairs)
    return {
        'names_equal': names_equal,
        'dims_equal': dims_equal,
        'max_matrix_abs_diff': max_diff,
        'pairs_equal': pairs_equal,
        'python_pairs': py_res['pairs'],
        'node_pairs': node_res['pairs'],
    }
