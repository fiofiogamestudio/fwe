const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const graphSource = fs.readFileSync(path.join(__dirname, '../public/graph.js'), 'utf8');
const appSource = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');

function graphView(width, height, contentWidth, contentHeight, config = {}) {
  const context = { state: { domain: { graph: { view: config } },
    view: { scale: 1, tx: 0, ty: 0, contentWidth, contentHeight, resetPending: true } },
  graphViewport: { clientWidth: width, clientHeight: height }, graphStage: { style: {} }, viewScaleText: {},
  isFreeGraph: () => false, isBlueprintGraph: () => false,
  graphNodes: { querySelector: () => ({ style: { left: '80px', top: '40px' }, offsetWidth: 240 }) } };
  vm.createContext(context);
  const constants = ['MIN_VIEW_SCALE', 'MAX_VIEW_SCALE', 'FIT_VIEW_PADDING', 'FIT_VIEW_HUD_RESERVE', 'GRAPH_NODE_WIDTH', 'GRAPH_NODE_HEIGHT']
    .map(name => appSource.match(new RegExp(`^const ${name} = .+;$`, 'm'))[0]);
  const functions = ['getViewportMetrics', 'clampViewScale', 'clampGraphView', 'applyGraphView', 'zoomGraphView', 'focusGraphNode'].map(name => {
    const start = graphSource.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `Missing ${name}`);
    const end = graphSource.indexOf('\nfunction ', start + 1);
    return graphSource.slice(start, end < 0 ? undefined : end);
  });
  vm.runInContext([...constants, ...functions].join('\n'), context);
  return context;
}

function focusableGraph(width = 856, height = 744) {
  const ctx = graphView(width, height, 1848, 2400);
  const effects = { commits: 0, renders: 0, notifications: 0, statuses: [] };
  const elements = [{ dataset: { key: 'nodes:1' }, style: { left: '80px', top: '40px' }, offsetWidth: 240, offsetHeight: 140 },
    { dataset: { key: 'options:100' }, style: { left: '1100px', top: '1900px' }, offsetWidth: 240, offsetHeight: 300 }];
  Object.assign(ctx.state, { domain: { kind: 'graph' }, data: { nodes: [{ id: 1 }], options: [{ id: 100 }] },
    selectedKey: 'nodes:1', selectedEdge: null, dirty: false, jsonDirty: false, resourceLoading: false });
  Object.assign(ctx, {
    graphNodes: { querySelectorAll: () => elements, querySelector: () => elements[0] },
    commitFocusedInspectorControl: () => { effects.commits += 1; },
    resetJsonDraftState: () => { ctx.state.jsonDirty = false; ctx.state.jsonDraft = ''; },
    renderInspector: () => { effects.renders += 1; }, renderGraph: () => { effects.renders += 1; },
    updateActionButtons: () => {}, dispatchSelectionIfChanged: () => { effects.notifications += 1; },
    setStatus: (message) => effects.statuses.push(message), getAppLabel: (_, fallback) => fallback
  });
  return { ctx, effects, elements };
}

test('focus selects an off-screen option, centers its rendered bounds and keeps subsequent zoom coherent', () => {
  const { ctx, effects, elements } = focusableGraph();
  const dataBefore = JSON.stringify(ctx.state.data);
  assert.equal(ctx.focusGraphNode('options:100'), true);
  const view = ctx.state.view;
  assert.equal(ctx.state.selectedKey, 'options:100');
  assert.equal(view.scale, 1);
  const center = { x: 1220, y: 2050 };
  assert.equal(view.tx + center.x * view.scale, 856 / 2);
  assert.equal(view.ty + center.y * view.scale, (744 - 58) / 2);
  assert.equal(view.resetPending, false);
  assert.equal(effects.commits, 1);
  assert.equal(effects.notifications, 1);
  assert.equal(ctx.state.dirty, false);
  assert.equal(JSON.stringify(ctx.state.data), dataBefore);
  const pointer = { x: 250, y: 220 };
  const worldX = (pointer.x - view.tx) / view.scale;
  const worldY = (pointer.y - view.ty) / view.scale;
  ctx.zoomGraphView(0.9, pointer.x, pointer.y);
  assert.ok(Math.abs(view.tx + worldX * view.scale - pointer.x) < 1e-8);
  assert.ok(Math.abs(view.ty + worldY * view.scale - pointer.y) < 1e-8);
  assert.equal(ctx.graphStage.style.transform, `translate(${view.tx}px, ${view.ty}px) scale(${view.scale})`);
  assert.equal(elements.length, 2);
});

test('focus scales a tall rendered node to fit a small viewport without covering the HUD', () => {
  const { ctx, elements } = focusableGraph(354, 200);
  assert.equal(ctx.focusGraphNode('options:100'), true);
  const view = ctx.state.view;
  const node = elements[1];
  const top = 1900 * view.scale + view.ty;
  const left = 1100 * view.scale + view.tx;
  assert.equal(view.scale, 86 / 300);
  assert.ok(top >= 28 && top + node.offsetHeight * view.scale <= 200 - 58 - 28);
  assert.ok(left >= 28 && left + node.offsetWidth * view.scale <= 354 - 28);
});

test('invalid graph focus requests preserve selection, drafts, camera and data', () => {
  for (const setup of [() => {}, (ctx) => { ctx.state.domain.kind = 'document'; },
    (ctx) => { ctx.state.data = null; }, (ctx) => { ctx.state.resourceLoading = true; }]) {
    const { ctx, effects } = focusableGraph();
    setup(ctx);
    const before = JSON.stringify(ctx.state);
    const target = ctx.state.domain.kind === 'graph' && ctx.state.data && !ctx.state.resourceLoading ? 'nodes:missing' : 'nodes:1';
    assert.equal(ctx.focusGraphNode(target), false);
    assert.equal(JSON.stringify(ctx.state), before);
    assert.equal(effects.commits + effects.renders + effects.notifications, 0);
  }
});

test('focus preserves an unapplied JSON draft and allows recentering its current node', () => {
  const { ctx, effects } = focusableGraph();
  ctx.state.jsonDirty = true;
  ctx.state.jsonDraft = '{ unfinished';
  const before = JSON.stringify(ctx.state);
  assert.equal(ctx.focusGraphNode('options:100'), false);
  assert.equal(JSON.stringify(ctx.state), before);
  assert.equal(effects.commits + effects.renders, 0);
  assert.equal(effects.statuses.length, 1);
  assert.equal(ctx.focusGraphNode('nodes:1'), true);
  assert.equal(ctx.state.jsonDraft, '{ unfinished');
  assert.equal(ctx.state.jsonDirty, true);
});

test('focus commits pending form edits before rendering and rejects a key removed by that commit', () => {
  const { ctx, effects, elements } = focusableGraph();
  ctx.commitFocusedInspectorControl = () => {
    effects.commits += 1;
    elements.pop();
  };
  assert.equal(ctx.focusGraphNode('options:100'), false);
  assert.equal(ctx.state.selectedKey, 'nodes:1');
  assert.equal(effects.commits, 1);
  assert.equal(effects.renders, 0);
});
