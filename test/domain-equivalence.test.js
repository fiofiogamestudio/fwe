const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const { compareDomainValues, projectDomainRuntime } = require('../src/domain-equivalence');
const { compareDomainConfigs, parseArgs } = require('../src/server');

test('domain equivalence ignores authoring metadata but compares browser runtime behavior', () => {
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

test('domain equivalence covers current group, workbench, and graph semantics', () => {
  const base = {
    id: 'flow',
    title: 'Flow',
    group: 'Gameplay',
    source: { type: 'single-json', path: 'flow.json' },
    workbench: { layout: 'catalog', collections: [{ id: 'nodes', path: 'nodes' }] },
    graph: { nodes: 'nodes', edges: 'edges', layout: 'free' }
  };

  for (const [pathPattern, changed] of [
    [/\$\.group/, { ...base, group: 'Tools' }],
    [/\$\.workbench\.layout/, { ...base, workbench: { ...base.workbench, layout: 'panels' } }],
    [/\$\.graph\.layout/, { ...base, graph: { ...base.graph, layout: 'fixed' } }]
  ]) {
    const comparison = compareDomainValues(base, changed);
    assert.equal(comparison.equivalent, false);
    assert.match(comparison.differences.join('\n'), pathPattern);
  }
});

test('domain equivalence reports missing fields, array changes, and bounded output', () => {
  const comparison = compareDomainValues(
    { id: 'one', source: { type: 'folder-json', path: 'one' }, view: [{ type: 'table' }] },
    {
      id: 'one',
      source: { type: 'folder-json', path: 'one', extensions: ['.json'] },
      view: [{ type: 'table' }, { type: 'json' }],
      defaults: { one: 1, two: 2 }
    },
    { maxDifferences: 2 }
  );
  assert.equal(comparison.equivalent, false);
  assert.equal(comparison.differences.length, 2);
  assert.match(comparison.differences.join('\n'), /missing from left domain|array length differs/);
});

test('browser projection and comparison normalize source identity defaults', () => {
  const projected = projectDomainRuntime({
    id: 'items',
    title: 'Items',
    format: 'json',
    kind: 'table',
    source: { type: 'folder-json', path: 'items' }
  });

  assert.equal(projected.source.identity, undefined);
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

test('compare CLI requires and parses two domain paths', () => {
  assert.deepEqual(parseArgs(['--compare', 'left.fwe.json', 'right.fwe']).compare, [
    'left.fwe.json',
    'right.fwe'
  ]);
  assert.throws(
    () => compareDomainConfigs({ app: '', compare: ['left.fwe.json'] }),
    /requires two domain config paths/
  );
});
