const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const graphSource = fs.readFileSync(path.join(__dirname, '../public/graph.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
const get = (object, key) => String(key).split('.').reduce((value, part) => value?.[part], object);
function fixture() {
  const context = { state: { domain: { kind: 'graph', graph: { nodes: 'nodes', entry: 'meta.entry',
    edges: [{ from: 'next', to: 'nodes.id', emptyValues: [0] }, { from: 'branches', to: 'nodes.id', kind: 'parallel', deleteFallback: false }],
    entryBranches: [{ path: 'meta.branches', target: 'nodes', label: 'Parallel' }],
    terminalLabels: { task: { title: 'Branch complete', text: 'Main flow continues' } },
    mutations: { __start__: [{ id: 'launch', type: 'append', edge: 'meta.branches', target: 'nodes', defaults: { kind: 'task', next: 0 } }] }
  } }, data: { meta: { entry: 1, branches: [10] }, nodes: [{ id: 1, next: 2 }, { id: 2 }, { id: 10, kind: 'task', next: 11 }, { id: 11, kind: 'task', next: 0 }] } },
  getByPath: get, parsePathParts: key => key.split('.'), singular: key => key.replace(/s$/, ''),
  ensureArray: (value, options = {}) => Array.isArray(value) ? value : options.scalar && value != null ? [value] : [],
  BUILT_IN_GRAPH_PROFILES: {}, getAppLabel: (_, fallback) => fallback };
  vm.createContext(context);
  const constants = appSource.split('\n').filter(line => /^const (GRAPH_|FIXED_|START_NODE_KEY|END_NODE_PREFIX)/.test(line));
  vm.runInContext(constants.join('\n') + '\n' + graphSource, context);
  context.getGraphNodeSize = () => ({ width: 240, height: 120 });
  return context;
}

test('parallel entry targets occupy independent columns and retain separate terminal labels', () => {
  const ctx = fixture(); const model = ctx.buildGraphModel(); const layout = ctx.layoutFixedGraph(model);
  assert.ok(!model.edges.some(edge => edge.to === 'nodes:0'), 'Configured terminal sentinel must not become a dangling edge');
  const roots = layout.edges.filter(edge => edge.from === '__start__');
  assert.deepEqual(Array.from(roots, edge => edge.to), ['nodes:1', 'nodes:10']);
  assert.equal(layout.positions.get('nodes:1').y, layout.positions.get('nodes:10').y);
  assert.notEqual(layout.positions.get('nodes:1').x, layout.positions.get('nodes:10').x);
  assert.equal(layout.nodes.find(node => node.from === 'nodes:11').title, 'Branch complete');
  assert.equal(layout.nodes.find(node => node.from === 'nodes:2').title, '结束');
});

test('a node with only parallel launches retains its own flow ending', () => {
  const ctx = fixture(); ctx.state.data.meta.branches = []; ctx.state.data.nodes[1].branches = [10];
  const layout = ctx.layoutFixedGraph(ctx.buildGraphModel());
  assert.ok(layout.edges.some(edge => edge.from === 'nodes:2' && edge.to === 'nodes:10' && edge.kind === 'parallel'));
  assert.ok(layout.nodes.some(node => node.from === 'nodes:2' && node.virtual === 'end'));
  const ending = layout.nodes.find(node => node.from === 'nodes:2');
  assert.notEqual(layout.positions.get(ending.key).x, layout.positions.get('nodes:10').x);
});

test('start append and deletion update root branch references without replacing the main entry', () => {
  const ctx = fixture();
  Object.assign(ctx, {
    setByPath(object, key, value) { const parts = key.split('.'), last = parts.pop(); parts.reduce((parent, part) => parent[part] ??= {}, object)[last] = value; },
    createDefaultGraphCollectionItem: () => ({ id: 12, kind: 'task', next: 0 }),
    getGraphCollectionPath: collection => collection, pushHistory: () => {},
    formatAppLabel: (_, fallback) => fallback, applyGenericGraphMutationClears: () => {}, markDirtyAndRender: () => {},
    isGraphEmptyMutationValue: value => value == null
  });
  const functions = ['appendGenericGraphReference', 'rewriteGraphReferences', 'rewriteGraphReferenceAtPath', 'rewriteGraphReferenceValue'].map(name => {
    const start = appSource.indexOf(`function ${name}(`), end = appSource.indexOf('\nfunction ', start + 1);
    return appSource.slice(start, end);
  });
  vm.runInContext(functions.join('\n'), ctx);
  const graph = ctx.buildGraphModel(), start = ctx.getGraphContextNode('__start__', graph);
  assert.equal(ctx.appendGenericGraphReference(start, ctx.getGenericGraphMutationActions(start, graph)[0]), true);
  assert.deepEqual(Array.from(ctx.state.data.meta.branches), [10, 12]);
  assert.equal(ctx.state.data.meta.entry, 1);
  ctx.state.data.nodes[1].branches = [10, 12];
  ctx.rewriteGraphReferences('nodes', 10, 11);
  assert.deepEqual(Array.from(ctx.state.data.meta.branches), [12]);
  assert.deepEqual(Array.from(ctx.state.data.nodes[1].branches), [12]);
  assert.equal(ctx.state.data.meta.entry, 1);
});

test('configured start menu receives document root without becoming a data node', () => {
  const ctx = fixture(), graph = ctx.buildGraphModel();
  const start = ctx.getGraphContextNode('__start__', graph);
  assert.equal(start.value, ctx.state.data);
  assert.equal(ctx.getGenericGraphMutationActions(start, graph)[0].edge, 'meta.branches');
  assert.equal(graph.nodeMap.has('__start__'), false);
  delete ctx.state.domain.graph.mutations.__start__;
  assert.equal(ctx.getGraphContextNode('__start__', graph), undefined);
});

test('a parallel flow stays outside the full main flow including later forks', () => {
  const ctx = fixture();
  ctx.state.domain.graph.edges.push({ from: 'forks', to: 'nodes.id' });
  ctx.state.data.nodes = [
    { id: 1, next: 2 }, { id: 2, forks: [3, 4] },
    { id: 3, forks: [5, 6] }, { id: 4 }, { id: 5 }, { id: 6 },
    { id: 10, kind: 'task', next: 11 },
    { id: 11, kind: 'task', forks: [12, 13] },
    { id: 12, kind: 'task' }, { id: 13, kind: 'task' }
  ];
  const layout = ctx.layoutFixedGraph(ctx.buildGraphModel());
  const mainKeys = new Set([1, 2, 3, 4, 5, 6].map(id => `nodes:${id}`));
  const parallelKeys = new Set([10, 11, 12, 13].map(id => `nodes:${id}`));
  for (const node of layout.nodes.filter(node => node.virtual === 'end')) {
    (mainKeys.has(node.from) ? mainKeys : parallelKeys).add(node.key);
  }
  const mainRight = Math.max(...Array.from(mainKeys, key => layout.positions.get(key).x + layout.sizes.get(key).width));
  const branchLeft = Math.min(...Array.from(parallelKeys, key => layout.positions.get(key).x));
  assert.ok(mainRight < branchLeft, 'The complete parallel subtree must sit outside all main flow forks');
  for (const edge of layout.edges.filter(edge => mainKeys.has(edge.from) && mainKeys.has(edge.to))) {
    assert.ok(edge.maxX < branchLeft, `Main edge ${edge.from} -> ${edge.to} entered the parallel region`);
  }
  assert.equal(layout.positions.get('nodes:1').y, layout.positions.get('nodes:10').y);
});

test('node launches and nested launches reserve complete separate flow regions', () => {
  const ctx = fixture();
  ctx.state.data.meta.branches = [];
  ctx.state.domain.graph.edges.push({ from: 'forks', to: 'nodes.id' });
  ctx.state.data.nodes = [
    { id: 1, branches: [10], next: 2 }, { id: 2, forks: [3, 4] }, { id: 3 }, { id: 4 },
    { id: 10, branches: [20], forks: [11, 12] }, { id: 11 }, { id: 12 },
    { id: 20, next: 21 }, { id: 21 }
  ];
  const layout = ctx.layoutFixedGraph(ctx.buildGraphModel());
  const xs = ids => ids.map(id => layout.positions.get(`nodes:${id}`).x);
  assert.ok(Math.max(...xs([1, 2, 3, 4])) < Math.min(...xs([10, 11, 12])));
  assert.ok(Math.max(...xs([10, 11, 12])) < Math.min(...xs([20, 21])));
  assert.ok(layout.positions.get('nodes:10').y > layout.positions.get('nodes:1').y);
});

test('duplicate launches and cycles terminate without moving already placed nodes', () => {
  const ctx = fixture();
  ctx.state.data.meta.branches = [10, 10];
  ctx.state.data.nodes[0].branches = [10];
  ctx.state.data.nodes[3].next = 10;
  const layout = ctx.layoutFixedGraph(ctx.buildGraphModel());
  assert.equal(layout.nodes.filter(node => node.key === 'nodes:10').length, 1);
  assert.ok(layout.positions.get('nodes:10').x > layout.positions.get('nodes:2').x);
  assert.ok(layout.edges.every(edge => !/NaN|undefined/.test(edge.path)));
});

test('disconnected components retain their own sequential layout', () => {
  const ctx = fixture();
  ctx.state.data.nodes.push({ id: 20, next: 21 }, { id: 21, next: 22 }, { id: 22 });
  const layout = ctx.layoutFixedGraph(ctx.buildGraphModel());
  const positions = [20, 21, 22].map(id => layout.positions.get(`nodes:${id}`));
  assert.equal(positions[0].x, positions[1].x);
  assert.equal(positions[1].x, positions[2].x);
  assert.ok(positions[0].y < positions[1].y && positions[1].y < positions[2].y);
});
