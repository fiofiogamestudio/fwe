const test = require('node:test');
const assert = require('node:assert/strict');

const path = require('node:path');

const { compareDomainValues, projectDomainRuntime } = require('../src/domain-equivalence');
const { compareDomainConfigs } = require('../src/server');

test('domain equivalence ignores source-format metadata but compares runtime behavior', () => {
  const left = {
    id: 'items',
    kind: 'table',
    modelTemplate: 'json.table',
    schema: { language: 'json' },
    source: { type: 'folder-json', path: 'items' },
    columns: ['id', 'name']
  };
  const right = {
    id: 'items',
    kind: 'table',
    modelTemplate: 'fwe',
    schema: { language: 'fwe', root: 'ItemFile' },
    source: { type: 'folder-json', path: 'items' },
    columns: ['id', 'name']
  };

  assert.equal(compareDomainValues(left, right).equivalent, true);
  right.columns = ['id', 'price'];
  const comparison = compareDomainValues(left, right);
  assert.equal(comparison.equivalent, false);
  assert.match(comparison.differences.join('\n'), /\$\.columns\[1\]/);
});

test('domain equivalence reports missing fields and array length changes', () => {
  const comparison = compareDomainValues(
    { id: 'one', source: { type: 'folder-json', path: 'one' }, view: [{ type: 'table' }] },
    {
      id: 'one',
      source: { type: 'folder-json', path: 'one', extensions: ['.json'] },
      view: [{ type: 'table' }, { type: 'json' }]
    }
  );
  assert.equal(comparison.equivalent, false);
  assert.match(comparison.differences.join('\n'), /missing from left domain/);
  assert.match(comparison.differences.join('\n'), /array length differs/);
});

test('runtime projection normalizes defaults used by the client', () => {
  const projected = projectDomainRuntime({
    id: 'items',
    title: 'Items',
    format: 'json',
    kind: 'table',
    source: { type: 'folder-json', path: 'items' }
  });

  assert.equal(projected.source.identity, 'id');
  assert.deepEqual(projected.actions, {});
  assert.deepEqual(projected.view, []);
  assert.equal(projected.workbench, null);
  assert.equal(compareDomainValues(
    { id: 'items', source: { type: 'folder-json', path: 'items' } },
    { id: 'items', source: { type: 'folder-json', path: 'items', identity: 'id' }, actions: {} }
  ).equivalent, true);
});

test('JSON and DSL configs can be verified after compilation', () => {
  const fixtures = path.join(__dirname, 'fixtures', 'equivalence');
  const comparison = compareDomainConfigs({
    app: '',
    compare: [
      path.join(fixtures, 'notes.fwe.json'),
      path.join(fixtures, 'notes.fwe')
    ]
  });

  assert.equal(comparison.equivalent, true);
});
