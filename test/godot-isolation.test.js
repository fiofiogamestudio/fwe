const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

test('FWE carries a root Godot ignore marker so host imports do not generate component sidecars', () => {
  const marker = path.resolve(__dirname, '..', '.gdignore');
  const stat = fs.lstatSync(marker);
  assert.equal(stat.isFile(), true);
  assert.equal(stat.isSymbolicLink(), false);
  // Godot recognizes the filename; its contents are not a glob/exclusion list.
});
