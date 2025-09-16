#!/usr/bin/env node
// CLI that reads JSON from stdin: { people: Array<object>, options?: { filterColumn?: string } }
// Outputs JSON: { names, matrix, pairs, indexPairs }

const fs = require('fs');

(async function main() {
  try {
    // Lazy require to avoid circular
    const { solvePairs } = require('./solver.js');

    const input = await readStdin();
    const req = JSON.parse(input || '{}');
    const people = Array.isArray(req.people) ? req.people : [];
    const options = req.options || {};

    const result = await solvePairs(people, options);
    process.stdout.write(JSON.stringify(result));
  } catch (e) {
    process.stderr.write(String(e && e.stack || e));
    process.exit(1);
  }
})();

function readStdin() {
  return new Promise((resolve) => {
    let data = '';
    if (process.stdin.isTTY) {
      resolve('');
      return;
    }
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => data += chunk);
    process.stdin.on('end', () => resolve(data));
  });
}
