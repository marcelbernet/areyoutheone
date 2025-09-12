// --- Global State ---
let correctPairs = [];
let participantNames = [];
let compatibilityMatrix = [];
let participantsCached = [];
let allPeopleCached = [];
let isAdmin = false;
let allColumnsCached = [];
let uniqueValuesByColumn = {};
let latestGroups = [];
let correctPairKeySet = new Set();

// --- Deterministic RNG helpers for seeded shuffles ---
function mulberry32(seed) {
  let t = seed >>> 0;
  return function() {
    t += 0x6D2B79F5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(array, rnd) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function simpleHashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24);
  }
  return h >>> 0;
}

function computeSeed(pairs, numGroups) {
  const cfg = getConfig();
  const parts = [JSON.stringify(pairs), String(numGroups), cfg.filterColumn, cfg.filterValue, cfg.forceRemoveName];
  return simpleHashString(parts.join('|'));
}

// --- Utilities ---
function showError(message) {
  alert(message);
}

function getConfig() {
  return {
    filterColumn: (document.getElementById('filterColumnSelect').value || '').trim(),
    filterValue: (document.getElementById('filterValueSelect').value || '').trim(),
    forceRemoveName: (document.getElementById('forceRemoveSelect').value || '').trim(),
    numGroups: parseInt(document.getElementById('numGroups').value, 10) || 1,
  };
}

// --- CSV Parsing ---
async function parseCSVFile(file) {
  return new Promise((resolve, reject) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results.data),
      error: (err) => reject(err),
    });
  });
}

async function parseCSV() {
  const input = document.getElementById('csvFileInput');
  if (!input.files || !input.files[0]) {
    showError('Please upload a CSV file first.');
    throw new Error('CSV missing');
  }
  const rows = await parseCSVFile(input.files[0]);
  // Normalize keys by trimming
  return rows.map((row) => {
    const normalized = {};
    Object.keys(row).forEach((k) => {
      const key = (k || '').trim();
      normalized[key] = typeof row[k] === 'string' ? row[k].trim() : row[k];
    });
    return normalized;
  });
}

function filterComing(rows) {
  const { filterColumn, filterValue } = getConfig();
  if (!filterColumn || !filterValue) return rows;
  return rows.filter((r) => (r[filterColumn] || '').trim() === filterValue.trim());
}

// --- Compatibility (Original-style A/B/C typed questions) ---
function extractLeadingInteger(text) {
  const m = String(text ?? '').trim().match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : NaN;
}

function detectQuestionType(columnName) {
  const s = String(columnName || '').trim();
  if (!s) return null;
  const m = s.match(/\(([ABC])\)\s*$/i);
  return m ? m[1].toUpperCase() : null;
}

function getQuestionSpecs(people, attendanceColumn) {
  const nameKey = 'Name and surname';
  const allKeys = Object.keys(people[0] || {});
  const questionKeys = allKeys.filter((k, idx) => {
    if (k === nameKey) return false;
    if (k === attendanceColumn) return false;
    const t = detectQuestionType(k);
    return Boolean(t);
  });
  return questionKeys.map((key) => {
    const t = detectQuestionType(key);
    let minV = Infinity;
    let maxV = -Infinity;
    if (t === 'B') {
      people.forEach((p) => {
        const v = extractLeadingInteger(p[key]);
        if (!Number.isNaN(v)) {
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
        }
      });
      if (minV === Infinity || maxV === -Infinity) { minV = 0; maxV = 1; }
    }
    return { key, type: t, minV, maxV };
  });
}

function scoreAnswerPair(aNum, bNum, type, minV = 0, maxV = 1) {
  if (type === 'A') {
    return aNum === bNum ? 1 : 0;
  }
  if (type === 'B') {
    // Notebook uses 1 - |a-b| / b_max, with b_max = number of options (e.g., 5 or 7)
    const denom = Math.max(1, maxV); // assumes answers are 1..maxV
    return 1 - (Math.abs(aNum - bNum) / denom);
  }
  if (type === 'C') {
    return aNum === bNum ? 0 : 1;
  }
  return 0;
}

function buildCompatibilityMatrix(people) {
  const { filterColumn } = getConfig();
  const specs = getQuestionSpecs(people, filterColumn);
  try { console.log('buildCompatibilityMatrix: people=', people.length, 'questions=', specs.length); } catch (e) {}
  const n = people.length;
  const matrix = Array.from({ length: n }, () => Array(n).fill(0));
  for (let i = 0; i < n; i += 1) {
    for (let j = i + 1; j < n; j += 1) {
      let points = 0;
      specs.forEach(({ key, type, minV, maxV }) => {
        const ai = extractLeadingInteger(people[i][key]);
        const aj = extractLeadingInteger(people[j][key]);
        if (Number.isNaN(ai) || Number.isNaN(aj)) return;
        points += scoreAnswerPair(ai, aj, type, minV, maxV);
      });
      matrix[i][j] = points;
      matrix[j][i] = points;
    }
  }
  // Final normalization: shift matrix so the minimum off-diagonal is at least 0
  let minVal = Infinity;
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      if (i === j) continue;
      const v = Number(matrix[i][j] || 0);
      if (v < minVal) minVal = v;
    }
  }
  if (minVal === Infinity) minVal = 0;
  if (minVal < 0) {
    const shift = -minVal;
    for (let i = 0; i < n; i += 1) {
      for (let j = 0; j < n; j += 1) {
        if (i === j) { matrix[i][j] = 0; continue; }
        matrix[i][j] = Math.max(0, Number(matrix[i][j] || 0) + shift);
      }
    }
  } else {
    for (let i = 0; i < n; i += 1) matrix[i][i] = 0;
  }
  try {
    const names = people.map((p) => p['Name and surname']);
    // Log a compact view to the console to help debug
    console.groupCollapsed('Compatibility matrix');
    console.log('Participants:', names);
    console.table(matrix.map((row, i) => ({ Name: names[i], ...Object.fromEntries(row.map((v, j) => [names[j], v])) })));
    console.groupEnd();
  } catch (e) {
    // no-op logging guard
  }
  return matrix;
}

// --- Solver (Greedy matching) ---
// Returns array of [i, j] pairs covering all participants
function greedyPairing(matrix) {
  const n = matrix.length;
  const used = new Array(n).fill(false);
  const pairs = [];
  for (let i = 0; i < n; i += 1) {
    if (used[i]) continue;
    let bestJ = -1;
    let bestScore = -Infinity;
    for (let j = 0; j < n; j += 1) {
      if (i === j || used[j]) continue;
      if (matrix[i][j] > bestScore) {
        bestScore = matrix[i][j];
        bestJ = j;
      }
    }
    if (bestJ === -1) continue;
    used[i] = true;
    used[bestJ] = true;
    pairs.push([i, bestJ]);
  }
  return pairs;
}

async function runSolver(people, matrix) {
  // Try OR-Tools WASM assignment solver. If unavailable, fallback to greedy.
  try {
    // First, try external adapter exposed by wasm-or-tools (see README)
    const n = matrix.length;
    if (n % 2 !== 0) throw new Error('Participants must be even');
    const half = n / 2;
    const leftIdx = Array.from({ length: half }, (_, i) => i);
    const rightIdx = Array.from({ length: half }, (_, i) => i + half);

    // Build cost matrix from negative scores (maximize score == minimize cost)
    const cost = leftIdx.map((i) => rightIdx.map((j) => -matrix[i][j]));

    if (typeof window !== 'undefined' && typeof window.solveLinearAssignment === 'function') {
      const assignmentIdx = await window.solveLinearAssignment(cost); // returns array of indexes on right
      const pairs = [];
      for (let i = 0; i < half; i += 1) {
        pairs.push([leftIdx[i], rightIdx[assignmentIdx[i]]]);
      }
      return pairs;
    }

    // Legacy: attempt global ortools object if provided by other builds
    if (typeof ortools === 'undefined' || !ortools) throw new Error('ortools missing');
    await ortools.init();

    // We need a square matrix for assignment. Pair first half with second half.
    const assignment = new ortools.Assignment();
    assignment.minimize(cost);
    const status = assignment.solve();
    if (status !== 'OPTIMAL' && status !== 'FEASIBLE') throw new Error('Assignment failed');
    const pairs = [];
    for (let i = 0; i < half; i += 1) {
      const j = assignment.solution()[i]; // index in right side
      pairs.push([leftIdx[i], rightIdx[j]]);
    }
    return pairs;
  } catch (e) {
    console.warn('Falling back to greedy solver:', e);
    return greedyPairing(matrix);
  }
}

// --- Game UI population ---
function populateGuessingAreas(names) {
  const s1 = document.getElementById('person1-select');
  const s2 = document.getElementById('person2-select');
  [s1, s2].forEach((sel) => {
    sel.innerHTML = '';
    names.forEach((name) => {
      const opt = document.createElement('option');
      opt.value = name;
      opt.textContent = name;
      sel.appendChild(opt);
    });
  });

  renderFullGuessForAllGroups();
}

function collectFullGuesses() {
  const container = document.getElementById('full-guess-groups');
  const groupDivs = Array.from(container.querySelectorAll('.full-guess-group'));
  const guesses = [];
  groupDivs.forEach((div, gi) => {
    const rows = new Map();
    Array.from(div.querySelectorAll('select')).forEach((sel) => {
      const row = parseInt(sel.getAttribute('data-row') || '0', 10);
      const role = sel.getAttribute('data-role');
      if (!rows.has(row)) rows.set(row, { a: null, b: null });
      const rec = rows.get(row);
      if (role === 'a') rec.a = sel.value;
      if (role === 'b') rec.b = sel.value;
    });
    rows.forEach((rec) => {
      if (rec.a && rec.b) guesses.push([rec.a, rec.b, gi]);
    });
  });
  return guesses;
}

// --- Reveal renderers ---
function displayFinalPairs(pairs) {
  const out = document.getElementById('pairs-output');
  out.innerHTML = '';
  pairs.forEach((pair) => {
    const pill = document.createElement('div');
    pill.className = 'pair-pill';
    pill.textContent = pair[0] + ' — ' + pair[1];
    out.appendChild(pill);
  });
}

function normalizeName(name) {
  return String(name || '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function makePairKey(a, b) {
  const n1 = normalizeName(a);
  const n2 = normalizeName(b);
  return n1 < n2 ? `${n1}|${n2}` : `${n2}|${n1}`;
}

function rebuildCorrectPairSet() {
  correctPairKeySet = new Set();
  (correctPairs || []).forEach((p) => {
    correctPairKeySet.add(makePairKey(p[0], p[1]));
  });
}

function isCorrectPair(a, b) {
  return correctPairKeySet.has(makePairKey(a, b));
}

function generateGroups(pairs, numGroups) {
  const seed = computeSeed(pairs, numGroups);
  const rnd = mulberry32(seed);
  const shuffled = seededShuffle(pairs, rnd);
  const groups = Array.from({ length: numGroups }, () => ({ pairs: [], people: [] }));
  shuffled.forEach((pair, i) => {
    const g = i % numGroups;
    groups[g].pairs.push(pair);
    groups[g].people.push(pair[0], pair[1]);
  });
  groups.forEach((g) => { g.people = seededShuffle(g.people, rnd); });
  return groups;
}

function displayGroups(groups) {
  const out = document.getElementById('groups-output');
  out.innerHTML = '';
  groups.forEach((g, idx) => {
    const card = document.createElement('div');
    card.innerHTML = `<strong>Group ${idx + 1}</strong>`;
    const list = document.createElement('div');
    g.people.forEach((p) => {
      const pill = document.createElement('div');
      pill.className = 'pair-pill';
      pill.textContent = p;
      list.appendChild(pill);
    });
    card.appendChild(list);
    out.appendChild(card);
  });
  // Also update the Guess UI for all groups
  renderFullGuessForAllGroups();
}

function displayIndividualStats(names, matrix) {
  const out = document.getElementById('stats-output');
  out.innerHTML = '';
  if (!names.length) return;
  const bestFor = names.map((name, i) => {
    let bestIdx = -1;
    let bestScore = -Infinity;
    for (let j = 0; j < names.length; j += 1) {
      if (i === j) continue;
      if (matrix[i][j] > bestScore) { bestScore = matrix[i][j]; bestIdx = j; }
    }
    return { name, match: names[bestIdx], score: bestScore };
  });
  bestFor.forEach((b) => {
    const pill = document.createElement('div');
    pill.className = 'pair-pill';
    pill.textContent = `${b.name} → best with ${b.match}`;
    out.appendChild(pill);
  });
}

// --- Dropdown helpers ---
function populateFilterColumnOptions(columns) {
  const sel = document.getElementById('filterColumnSelect');
  sel.innerHTML = '';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = '— Select column —';
  sel.appendChild(empty);
  columns.forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    sel.appendChild(opt);
  });
}

function populateFilterValueOptions(values) {
  const sel = document.getElementById('filterValueSelect');
  sel.innerHTML = '';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = '— Select value —';
  sel.appendChild(empty);
  values.forEach((v) => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    sel.appendChild(opt);
  });
}

function populateForceRemoveOptions(people) {
  const sel = document.getElementById('forceRemoveSelect');
  sel.innerHTML = '';
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = '— Nobody —';
  sel.appendChild(empty);
  const names = Array.from(new Set(people.map((p) => (p['Name and surname'] || '').trim()).filter(Boolean)));
  names.forEach((n) => {
    const opt = document.createElement('option');
    opt.value = n;
    opt.textContent = n;
    sel.appendChild(opt);
  });
}

function recomputeUniqueValuesByColumn(rows) {
  uniqueValuesByColumn = {};
  const cols = allColumnsCached;
  cols.forEach((c) => {
    uniqueValuesByColumn[c] = Array.from(new Set(rows.map((r) => (r[c] ?? '').toString().trim()).filter((v) => v !== ''))).sort();
  });
}

// Initialize dropdowns when a file is selected
document.addEventListener('DOMContentLoaded', () => {
  // Wire admin button only after DOM is ready
  const adminBtn = document.getElementById('adminLoginButton');
  if (adminBtn) {
    adminBtn.addEventListener('click', () => {
      const pwd = document.getElementById('adminPassword').value;
      if (pwd === 'admin') {
        isAdmin = true;
        document.getElementById('admin-content').classList.remove('hidden');
        const answersOut = document.getElementById('answers-output');
        answersOut.innerHTML = renderAnswersTable(participantsCached.length ? participantsCached : allPeopleCached);
        const matrixOut = document.getElementById('matrix-output');
        matrixOut.innerHTML = renderMatrixTable(participantNames, compatibilityMatrix);
      } else {
        showError('Wrong password');
      }
    });
  }

  const csvInput = document.getElementById('csvFileInput');
  if (csvInput) {
    csvInput.addEventListener('change', async () => {
      try {
        const rows = await parseCSV();
        allPeopleCached = rows;
        allColumnsCached = Object.keys(rows[0] || []);
        populateFilterColumnOptions(allColumnsCached);
        recomputeUniqueValuesByColumn(rows);
        populateFilterValueOptions([]);
        populateForceRemoveOptions(rows);
      } catch (e) {
        console.error(e);
      }
    });
  }

  const colSelect = document.getElementById('filterColumnSelect');
  if (colSelect) {
    colSelect.addEventListener('change', () => {
      const col = document.getElementById('filterColumnSelect').value;
      const values = uniqueValuesByColumn[col] || [];
      populateFilterValueOptions(values);
    });
  }

  // Group selection for guesses
  const groupSelect = document.getElementById('groupSelect');
  if (groupSelect) {
    groupSelect.addEventListener('change', () => {
      const idx = parseInt(groupSelect.value || '0', 10) || 0;
      renderFullGuessForGroup(idx);
    });
  }

  // Navigation buttons
  const backToSetup1 = document.getElementById('backToSetupButton');
  if (backToSetup1) backToSetup1.addEventListener('click', () => goTo('setup'));
  const backToGame = document.getElementById('backToGameButton');
  if (backToGame) backToGame.addEventListener('click', () => goTo('game'));
  const backToSetup2 = document.getElementById('backToSetupButton2');
  if (backToSetup2) backToSetup2.addEventListener('click', () => goTo('setup'));
});

function populateGroupSelect() {
  const sel = document.getElementById('groupSelect');
  if (!sel) return;
  sel.innerHTML = '';
  const n = parseInt(document.getElementById('numGroups').value, 10) || 1;
  for (let i = 0; i < n; i += 1) {
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `Group ${i + 1}`;
    sel.appendChild(opt);
  }
}

function renderFullGuessForAllGroups() {
  const container = document.getElementById('full-guess-groups');
  if (!container || container.children.length > 0) return;
  container.innerHTML = '';
  const nGroups = parseInt(document.getElementById('numGroups').value, 10) || 1;
  const groups = latestGroups;
  groups.forEach((g, gi) => {
    const people = [...g.people];
    const div = document.createElement('div');
    div.className = 'full-guess-group';
    const title = document.createElement('h4');
    title.textContent = `Group ${gi + 1}`;
    div.appendChild(title);
    const area = document.createElement('div');
    area.className = 'full-guess-area';
    const numRows = Math.floor(people.length / 2);
    for (let r = 0; r < numRows; r += 1) {
      const label = document.createElement('label');
      label.textContent = `Pair ${r + 1}:`;

      const selA = document.createElement('select');
      people.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        selA.appendChild(opt);
      });
      selA.setAttribute('data-group', String(gi));
      selA.setAttribute('data-row', String(r));
      selA.setAttribute('data-role', 'a');

      const selB = document.createElement('select');
      people.forEach((p) => {
        const opt = document.createElement('option');
        opt.value = p;
        opt.textContent = p;
        selB.appendChild(opt);
      });
      selB.setAttribute('data-group', String(gi));
      selB.setAttribute('data-row', String(r));
      selB.setAttribute('data-role', 'b');

      area.appendChild(label);
      area.appendChild(selA);
      area.appendChild(selB);
    }
    div.appendChild(area);

    const btn = document.createElement('button');
    btn.id = `checkGroupGuessButton-${gi}`;
    btn.textContent = 'Check My Guesses (Group ' + (gi + 1) + ')';
    const resultP = document.createElement('p');
    resultP.id = `group-guess-result-${gi}`;
    resultP.className = 'result';
    btn.addEventListener('click', () => {
      const { correct, total } = evaluateGroupGuesses(gi);
      resultP.textContent = `You found ${correct} out of ${total} perfect matches in Group ${gi + 1}!`;
    });
    div.appendChild(btn);
    div.appendChild(resultP);

    container.appendChild(div);
  });
}

function evaluateGroupGuesses(groupIndex) {
  const container = document.getElementById('full-guess-groups');
  const groupDivs = Array.from(container.querySelectorAll('.full-guess-group'));
  const div = groupDivs[groupIndex];
  if (!div) return { correct: 0, total: 0 };
  const rows = new Map();
  Array.from(div.querySelectorAll('select')).forEach((sel) => {
    const row = parseInt(sel.getAttribute('data-row') || '0', 10);
    const role = sel.getAttribute('data-role');
    if (!rows.has(row)) rows.set(row, { a: null, b: null });
    const rec = rows.get(row);
    if (role === 'a') rec.a = sel.value;
    if (role === 'b') rec.b = sel.value;
  });
  let correct = 0;
  let total = 0;
  rows.forEach((rec) => {
    if (!rec.a || !rec.b) return;
    total += 1;
    const ok = isCorrectPair(rec.a, rec.b);
    if (ok) correct += 1;
  });
  return { correct, total };
}

function goTo(view) {
  if (view === 'setup') {
    document.getElementById('results-section').classList.add('hidden');
    document.getElementById('game-section').classList.add('hidden');
    document.getElementById('setup-section').classList.remove('hidden');
    history.pushState({ view: 'setup' }, '', '#setup');
    return;
  }
  if (view === 'game') {
    document.getElementById('setup-section').classList.add('hidden');
    document.getElementById('results-section').classList.add('hidden');
    document.getElementById('game-section').classList.remove('hidden');
    history.pushState({ view: 'game' }, '', '#game');
    return;
  }
  if (view === 'results') {
    document.getElementById('setup-section').classList.add('hidden');
    document.getElementById('game-section').classList.add('hidden');
    document.getElementById('results-section').classList.remove('hidden');
    history.pushState({ view: 'results' }, '', '#results');
  }
}

window.addEventListener('popstate', (e) => {
  const state = e.state || {};
  if (state.view) {
    if (state.view === 'setup') {
      document.getElementById('results-section').classList.add('hidden');
      document.getElementById('game-section').classList.add('hidden');
      document.getElementById('setup-section').classList.remove('hidden');
    } else if (state.view === 'game') {
      document.getElementById('setup-section').classList.add('hidden');
      document.getElementById('results-section').classList.add('hidden');
      document.getElementById('game-section').classList.remove('hidden');
    } else if (state.view === 'results') {
      document.getElementById('setup-section').classList.add('hidden');
      document.getElementById('game-section').classList.add('hidden');
      document.getElementById('results-section').classList.remove('hidden');
    }
  }
});

// --- Event wiring ---
document.getElementById('runButton').addEventListener('click', async () => {
  console.log('[AYTO] runButton clicked');
  try {
    // 1. Load and filter
    const allPeople = await parseCSV();
    console.log('[AYTO] parsed CSV rows:', allPeople.length);
    allPeopleCached = allPeople;
    let participants = filterComing(allPeople);
    const cfg = getConfig();
    console.log('[AYTO] filter config:', cfg);
    console.log('[AYTO] participants after filter:', participants.length);

    // 2. Odd count handling
    if (participants.length % 2 !== 0) {
      const { forceRemoveName } = getConfig();
      if (forceRemoveName) {
        participants = participants.filter((p) => (p['Name and surname'] || '').trim() !== forceRemoveName);
      } else {
        showError('Number of participants is odd. Please specify someone to remove.');
        return;
      }
    }

    if (participants.length < 2) {
      showError('Not enough participants after filtering.');
      console.warn('[AYTO] Aborting: participants < 2');
      return;
    }

    participantsCached = participants;

    // 4. Build matrix and solve
    console.log('[AYTO] calling buildCompatibilityMatrix');
    compatibilityMatrix = buildCompatibilityMatrix(participants);
    console.log('[AYTO] matrix built. size=', compatibilityMatrix.length);
    const optimalPairsResult = await runSolver(participants, compatibilityMatrix);

    // 5. Store solution
    correctPairs = optimalPairsResult.map((pair) => [
      participants[pair[0]]['Name and surname'],
      participants[pair[1]]['Name and surname'],
    ]);
    // Sort pairs alphabetically to ensure a canonical order
    correctPairs.forEach(p => p.sort());
    correctPairs.sort((a, b) => a[0].localeCompare(b[0]));
    rebuildCorrectPairSet();
    participantNames = participants.map((p) => p['Name and surname']);

    // 5.5. Generate groups for the game
    const { numGroups } = getConfig();
    latestGroups = generateGroups(correctPairs, numGroups);

    // 6. Transition UI
    document.getElementById('setup-section').classList.add('hidden');
    document.getElementById('game-section').classList.remove('hidden');
    populateGuessingAreas(participantNames);
    populateGroupSelect();
    goTo('game');
  } catch (e) {
    console.error(e);
    showError('Failed to process CSV. Please check the file format.');
  }
});

document.getElementById('checkSinglePairButton').addEventListener('click', () => {
  const name1 = document.getElementById('person1-select').value;
  const name2 = document.getElementById('person2-select').value;
  const resultElement = document.getElementById('single-pair-result');
  if (name1 === name2) {
    resultElement.textContent = "You can't pair someone with themself!";
    resultElement.className = 'result error';
    return;
  }
  const isCorrect = isCorrectPair(name1, name2);
  resultElement.textContent = isCorrect ? '✅ Correct! This is a perfect match!' : '❌ Incorrect. Try again!';
  resultElement.className = 'result ' + (isCorrect ? 'success' : 'error');
});

document.getElementById('checkFullGuessButton').addEventListener('click', () => {
  const userGuesses = collectFullGuesses();
  let correctCount = 0;
  userGuesses.forEach((userPair) => {
    const isCorrect = isCorrectPair(userPair[0], userPair[1]);
    if (!isCorrect) {
      try { console.debug('[AYTO] Not a match:', userPair[0], userPair[1], 'vs any of', correctPairs); } catch (e) {}
    }
    if (isCorrect) correctCount += 1;
  });
  const totalPairs = correctPairs.length;
  document.getElementById('full-guess-result').textContent = `You found ${correctCount} out of ${totalPairs} perfect matches!`;
});

document.getElementById('revealButton').addEventListener('click', () => {
  if (!isAdmin) {
    const pwd = window.prompt('Enter admin password to reveal results:');
    if (pwd !== 'admin') {
      showError('Wrong password');
      return;
    }
    isAdmin = true;
    // Optionally reveal admin content upon successful prompt
    document.getElementById('admin-content').classList.remove('hidden');
    const answersOut = document.getElementById('answers-output');
    answersOut.innerHTML = renderAnswersTable(participantsCached.length ? participantsCached : allPeopleCached);
    const matrixOut = document.getElementById('matrix-output');
    matrixOut.innerHTML = renderMatrixTable(participantNames, compatibilityMatrix);
  }
  document.getElementById('game-section').classList.add('hidden');
  document.getElementById('results-section').classList.remove('hidden');
  displayFinalPairs(correctPairs);
  displayGroups(latestGroups);
  displayIndividualStats(participantNames, compatibilityMatrix);
  populateGroupSelect();
  goTo('results');
});

// --- Admin: password and views ---
function renderAnswersTable(people) {
  if (!people || !people.length) return '<p class="hint">No data loaded.</p>';
  const columns = Object.keys(people[0]);
  const header = '<tr>' + columns.map((c) => `<th>${c}</th>`).join('') + '</tr>';
  const rows = people.map((p) => '<tr>' + columns.map((c) => `<td>${(p[c] ?? '')}</td>`).join('') + '</tr>').join('');
  return `<div style="overflow:auto"><table><thead>${header}</thead><tbody>${rows}</tbody></table></div>`;
}

function renderMatrixTable(names, matrix) {
  if (!names || !names.length) return '<p class="hint">No matrix available.</p>';
  const header = '<tr><th></th>' + names.map((n) => `<th>${n}</th>`).join('') + '</tr>';
  const body = names.map((n, i) => {
    const cells = names.map((_, j) => {
      const val = Math.max(0, Number(matrix[i][j] ?? 0));
      return `<td>${val.toFixed(2)}</td>`;
    }).join('');
    return `<tr><th>${n}</th>${cells}</tr>`;
  }).join('');
  return `<div style="overflow:auto"><table><thead>${header}</thead><tbody>${body}</tbody></table></div>`;
}

document.getElementById('adminLoginButton').addEventListener('click', () => {
  const pwd = document.getElementById('adminPassword').value;
  if (pwd === 'admin') {
    isAdmin = true;
    document.getElementById('admin-content').classList.remove('hidden');
    // Optionally hide login section
    // document.getElementById('admin-login-section').classList.add('hidden');
    // Render views using current filtered participants if available, else all
    const answersOut = document.getElementById('answers-output');
    answersOut.innerHTML = renderAnswersTable(participantsCached.length ? participantsCached : allPeopleCached);
    const matrixOut = document.getElementById('matrix-output');
    matrixOut.innerHTML = renderMatrixTable(participantNames, compatibilityMatrix);
  } else {
    showError('Wrong password');
  }
});


