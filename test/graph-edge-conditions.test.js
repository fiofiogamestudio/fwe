const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const graphSource = fs.readFileSync(path.join(__dirname, '../public/graph.js'), 'utf8');

function modelFor(edges, nodes, choices = []) {
  const data = { meta: { entry: 1 }, nodes, choices };
  const before = JSON.stringify(data);
  const context = {
    state: { domain: { kind: 'graph', graph: { nodes: 'nodes', entry: 'meta.entry', edges } }, data },
    getByPath: (object, key) => String(key).split('.').reduce((value, part) => value?.[part], object),
    parsePathParts: key => key.split('.'),
    singular: key => key.replace(/s$/, ''),
    ensureArray: (value, options = {}) => Array.isArray(value) ? value : options.scalar && value != null ? [value] : [],
    BUILT_IN_GRAPH_PROFILES: {},
    getAppLabel: (_, fallback) => fallback
  };
  vm.createContext(context);
  vm.runInContext(graphSource, context);
  const model = context.buildGraphModel();
  assert.equal(JSON.stringify(data), before, 'Conditional projection must not change source data.');
  return model;
}

test('empty/notEmpty edge rules treat blank strings and empty arrays as absent', () => {
  const edges = [
    { from: 'primary', to: 'nodes.id', when: { path: 'mode.value', empty: true } },
    { from: 'alternate', to: 'nodes.id', when: { path: 'mode.value', notEmpty: true } }
  ];
  for (const value of [undefined, null, '', ' \t\n', [], 'enabled', ['enabled'], 0, false]) {
    const empty = value == null || value === '' || value === ' \t\n' || (Array.isArray(value) && value.length === 0);
    const model = modelFor(edges, [{ id: 1, primary: 2, alternate: 3, mode: { value } }, { id: 2 }, { id: 3 }]);
    assert.equal(model.edges.length, 1, JSON.stringify(value));
    assert.equal(model.edges[0].to, empty ? 'nodes:2' : 'nodes:3');
    assert.equal(model.nodeMap.get('nodes:1').outgoing.length, 1);
    assert.equal(model.nodeMap.get(empty ? 'nodes:3' : 'nodes:2').incoming.length, 0);
  }
});

test('conditions are evaluated on the source item in the configured secondary collection', () => {
  const model = modelFor([
    'choiceIds -> choices.id',
    { from: 'choices.result', to: 'nodes.id', when: { path: 'enabled', equals: true }, emptyValues: [0], label: 'Approved' }
  ], [{ id: 1, choiceIds: [10, 11, 12] }, { id: 2 }], [
    { id: 10, enabled: true, result: 2 },
    { id: 11, enabled: false, result: 2 },
    { id: 12, enabled: true, result: 0 }
  ]);
  const projected = model.edges.filter(edge => edge.sourceCollection === 'choices');
  assert.equal(projected.length, 1);
  assert.equal(projected[0].from, 'choices:10');
  assert.equal(projected[0].to, 'nodes:2');
  assert.equal(projected[0].label, 'Approved');
  assert.equal(projected[0].dataPath, 'choices[0]');
});

test('oneOf conditions preserve the existing string-compatible value matching contract', () => {
  for (const [mode, expected] of [[1, true], ['accepted', true], ['blocked', false], [undefined, false]]) {
    const model = modelFor([{ from: 'next', to: 'nodes.id', when: { path: 'mode', oneOf: ['1', 'accepted'] } }],
      [{ id: 1, next: 2, mode }, { id: 2 }]);
    assert.equal(model.edges.length, expected ? 1 : 0);
  }
});

test('legacy string and object edge rules without conditions keep their targets and metadata', () => {
  const model = modelFor(['next -> nodes.id', { from: 'fallback', to: 'nodes.id', kind: 'recovery', label: 'Retry' }],
    [{ id: 1, next: 2, fallback: 3 }, { id: 2 }, { id: 3 }]);
  assert.deepEqual(Array.from(model.edges, edge => [edge.from, edge.to, edge.kind, edge.label]), [
    ['nodes:1', 'nodes:2', 'next', ''], ['nodes:1', 'nodes:3', 'recovery', 'Retry']
  ]);
});

test('mutation visibility shares edge conditions while preserving collection and visibleWhen filters', () => {
  const context = {
    getByPath: (object, key) => key ? key.split('.').reduce((value, part) => value?.[part], object) : object
  };
  vm.createContext(context);
  vm.runInContext(graphSource, context);
  const cases = [
    [undefined, { empty: true }, true], [null, { empty: true }, true],
    ['', { empty: true }, true], [' \t\n', { empty: true }, true], [[], { empty: true }, true],
    [0, { empty: true }, false], [false, { notEmpty: true }, true],
    [' \t', { notEmpty: true }, false], [' enabled ', { notEmpty: true }, true],
    [1, { equals: '1' }, true], [false, { equals: 'false' }, true],
    [' 1 ', { equals: '1' }, false], [2, { equals: 1 }, false],
    [1, { oneOf: ['1', 'accepted'] }, true], ['accepted', { oneOf: ['1', 'accepted'] }, true],
    ['rejected', { oneOf: ['1', 'accepted'] }, false]
  ];
  for (const [value, condition, expected] of cases) {
    const when = { path: 'mode', ...condition }, node = { collection: 'choices', value: { mode: value } };
    assert.equal(context.isGraphEdgeRuleEnabled({ when }, node.value), expected);
    assert.equal(context.isGenericGraphMutationVisible({ when }, node), expected);
    assert.equal(context.isGenericGraphMutationVisible({ visibleWhen: when }, node), expected);
    assert.equal(context.isGenericGraphMutationVisible({ when: { ...when, collection: 'other' } }, node), false);
    assert.equal(context.isGenericGraphMutationVisible({ when: { ...when, collection: 'choices' } }, node), expected);
  }
  assert.equal(context.isGenericGraphMutationVisible({}, { collection: 'choices', value: {} }), true);
});
