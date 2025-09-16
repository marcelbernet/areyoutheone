// Node-friendly solver module that mirrors the core logic from app.js without any DOM usage.
// Exports: buildCompatibilityMatrix(people, options), solvePairs(people, options)
// Options: { filterColumn?: string }

const { solveLinearAssignment } = require('./hungarian.js');

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
  const questionKeys = allKeys.filter((k) => {
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
  if (type === 'A') return aNum === bNum ? 1 : 0;
  if (type === 'B') {
    const denom = Math.max(1, maxV);
    return 1 - (Math.abs(aNum - bNum) / denom);
  }
  if (type === 'C') return aNum === bNum ? 0 : 1;
  return 0;
}

function buildCompatibilityMatrix(people, options = {}) {
  const { filterColumn } = options;
  const specs = getQuestionSpecs(people, filterColumn);
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
  // Normalize: zero diagonal and non-negative entries
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
  return matrix;
}

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

async function runSolver(matrix) {
  const n = matrix.length;
  if (n % 2 !== 0) throw new Error('Participants must be even');
  const half = n / 2;
  const leftIdx = Array.from({ length: half }, (_, i) => i);
  const rightIdx = Array.from({ length: half }, (_, i) => i + half);
  const cost = leftIdx.map((i) => rightIdx.map((j) => -matrix[i][j]));
  if (typeof solveLinearAssignment === 'function') {
    try {
      const assignmentIdx = await solveLinearAssignment(cost);
      const pairs = [];
      for (let i = 0; i < half; i += 1) pairs.push([leftIdx[i], rightIdx[assignmentIdx[i]]]);
      return pairs;
    } catch (e) {
      // fallthrough to greedy
    }
  }
  return greedyPairing(matrix);
}

async function solvePairs(people, options = {}) {
  if (!Array.isArray(people)) throw new Error('people must be an array');
  const matrix = buildCompatibilityMatrix(people, options);
  const idxPairs = await runSolver(matrix);
  const pairsByName = idxPairs.map(([i, j]) => {
    const a = (people[i]['Name and surname'] || '').trim();
    const b = (people[j]['Name and surname'] || '').trim();
    return [a, b].sort();
  });
  pairsByName.sort((a, b) => a[0].localeCompare(b[0]));
  const names = people.map((p) => (p['Name and surname'] || '').trim());
  return { names, matrix, pairs: pairsByName, indexPairs: idxPairs };
}

module.exports = {
  buildCompatibilityMatrix,
  solvePairs,
};
