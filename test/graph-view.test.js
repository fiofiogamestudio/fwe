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
  const constants = ['MIN_VIEW_SCALE', 'MAX_VIEW_SCALE', 'FIT_VIEW_PADDING', 'FIT_VIEW_HUD_RESERVE', 'GRAPH_NODE_WIDTH']
    .map(name => appSource.match(new RegExp(`^const ${name} = .+;$`, 'm'))[0]);
  const functions = ['getGraphFitScale', 'getViewportMetrics', 'clampViewScale', 'clampGraphView', 'applyGraphView',
    'fitGraphViewToContent', 'getGraphResetAnchor', 'resetGraphView', 'zoomGraphView'].map(name => {
    const start = graphSource.indexOf(`function ${name}(`);
    assert.ok(start >= 0, `Missing ${name}`);
    const end = graphSource.indexOf('\nfunction ', start + 1);
    return graphSource.slice(start, end < 0 ? undefined : end);
  });
  vm.runInContext([...constants, ...functions].join('\n'), context);
  return context;
}

for (const [width, height, contentWidth, contentHeight] of [
  [856, 744, 1848, 1294], [760, 266, 1848, 1294], [354, 200, 1848, 4000]
]) {
  test(`default reset fits the entire graph inside ${width}x${height} including the HUD reserve`, () => {
    const ctx = graphView(width, height, contentWidth, contentHeight);
    ctx.resetGraphView(false);
    const view = ctx.state.view;
    const expected = Math.min(1, (width - 56) / contentWidth, (height - 114) / contentHeight);
    assert.equal(view.scale, expected, 'default Reset must fit without a readable-size floor');
    assert.equal(view.resetPending, false);
    assert.ok(view.tx >= 0 && view.tx + contentWidth * view.scale <= width);
    assert.ok(view.ty >= 0 && view.ty + contentHeight * view.scale <= height - 58);
    ctx.zoomGraphView(view.scale * 1.1, width / 2, height / 2);
    assert.ok(Math.abs(view.scale - expected * 1.1) < 1e-10, 'first wheel step must not jump to a different minimum');
    ctx.zoomGraphView(expected * 0.9, width / 2, height / 2);
    assert.ok(view.scale <= expected, 'zooming out must not zoom in');
    ctx.zoomGraphView(100, width / 2, height / 2);
    assert.equal(view.scale, 1, 'readable zoom remains available');
    ctx.resetGraphView(false);
    assert.equal(view.scale, expected);
  });
}

test('small graphs reset at 100% and empty layouts produce finite transforms', () => {
  for (const dimensions of [[100, 100], [0, 0]]) {
    const ctx = graphView(856, 744, ...dimensions);
    ctx.resetGraphView(false);
    assert.equal(ctx.state.view.scale, 1);
    assert.ok(Number.isFinite(ctx.state.view.tx) && Number.isFinite(ctx.state.view.ty));
  }
});

for (const resetMinScale of [0.35, 0.62]) {
  test(`explicit resetMinScale ${resetMinScale} retains the legacy floor and fixed-graph anchor`, () => {
    const ctx = graphView(760, 266, 1848, 1294, { resetMinScale });
    ctx.resetGraphView(false);
    const view = ctx.state.view;
    assert.equal(view.scale, resetMinScale);
    assert.equal(view.tx, Math.round(760 * 0.28 - 200 * resetMinScale));
    assert.ok(view.ty + view.contentHeight * view.scale > 266, 'explicit readable-size override may crop the graph');
    ctx.zoomGraphView(view.scale * 0.9, 380, 133);
    assert.ok(Math.abs(view.scale - resetMinScale * 0.9) < 1e-10, 'reset floor must not restrict manual zoom');
    ctx.zoomGraphView(0, 380, 133);
    assert.equal(view.scale, 0.1);
    ctx.zoomGraphView(100, 380, 133);
    assert.equal(view.scale, 1);
  });
}

test('explicit floor below fit does not reduce the default fit scale or apply an anchor', () => {
  const ctx = graphView(856, 744, 1848, 1294, { resetMinScale: 0.35 });
  ctx.resetGraphView(false);
  assert.equal(ctx.state.view.scale, 800 / 1848);
  assert.equal(ctx.state.view.tx, 28);
});

test('free and blueprint graphs retain centered resets with an explicit floor', () => {
  for (const kind of ['isFreeGraph', 'isBlueprintGraph']) {
    const ctx = graphView(760, 266, 1848, 1294, { resetMinScale: 0.35 });
    ctx[kind] = () => true;
    ctx.resetGraphView(false);
    assert.equal(ctx.state.view.scale, 0.35);
    assert.equal(ctx.state.view.tx, Math.round((760 - 1848 * 0.35) / 2));
  }
});
