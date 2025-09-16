// Minimal Hungarian algorithm in JS for square matrices, returning assignment indices for rows -> cols.
// Cost matrix: cost[row][col]. Minimizes total cost.
// Exposes solveLinearAssignment(cost) Promise<number[]> on both browser (globalThis) and Node (module.exports).
(function(){
  function hungarian(cost) {
    const n = cost.length;
    const u = new Array(n + 1).fill(0);
    const v = new Array(n + 1).fill(0);
    const p = new Array(n + 1).fill(0);
    const way = new Array(n + 1).fill(0);
    for (let i = 1; i <= n; i++) {
      p[0] = i;
      let j0 = 0;
      const minv = new Array(n + 1).fill(Infinity);
      const used = new Array(n + 1).fill(false);
      do {
        used[j0] = true;
        const i0 = p[j0];
        let delta = Infinity;
        let j1 = 0;
        for (let j = 1; j <= n; j++) {
          if (used[j]) continue;
          const cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= n; j++) {
          if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
          else { minv[j] -= delta; }
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do {
        const j1 = way[j0];
        p[j0] = p[j1];
        j0 = j1;
      } while (j0 !== 0);
    }
    const assignment = new Array(n).fill(-1);
    for (let j = 1; j <= n; j++) if (p[j] > 0) assignment[p[j] - 1] = j - 1;
    return assignment;
  }

  const solve = async function(cost) {
    // Ensure square matrix
    const n = cost.length;
    for (let i = 0; i < n; i++) {
      if (cost[i].length !== n) throw new Error('Cost matrix must be square');
    }
    return hungarian(cost);
  };

  // Attach to global for browser and Node
  try { (typeof globalThis !== 'undefined') && (globalThis.solveLinearAssignment = solve); } catch (e) {}
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { solveLinearAssignment: solve };
  }
})();


