const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../public/graph.js'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '../public/app.js'), 'utf8');
function runtime() {
  const context = {};
  vm.createContext(context);
  const constants = app.split('\n').filter(line => /^const (GRAPH_|FIXED_)/.test(line));
  const start = source.indexOf('function buildFixedHorizontalRouteHints(');
  const end = source.indexOf('\nfunction layoutFreeGraph(', start);
  vm.runInContext(constants.join('\n') + '\n' + source.slice(start, end), context);
  return context;
}
function route(nodes, edges) {
  const ctx = runtime();
  const columns = new Map(nodes.map(node => [node.id, node.column]));
  const depths = new Map(nodes.map(node => [node.id, node.depth ?? node.y / 300]));
  const positions = new Map(nodes.map(node => [node.id, { x: 0, y: node.y }]));
  const sizes = new Map(nodes.map(node => [node.id, { width: 240, height: node.height || 120 }]));
  const top = new Map(), bottom = new Map();
  nodes.forEach(node => {
    const depth = depths.get(node.id);
    top.set(depth, Math.min(top.get(depth) ?? Infinity, node.y));
    bottom.set(depth, Math.max(bottom.get(depth) ?? 0, node.y + sizes.get(node.id).height));
  });
  const hints = ctx.buildFixedHorizontalRouteHints(edges, columns, depths);
  const plan = ctx.planFixedEdgeRoutes(edges, positions, sizes, columns, depths, top, bottom, hints);
  const columnX = ctx.buildFixedColumnXMap(nodes.map(node => ({ column: node.column })), plan.leftCounts, plan.rightCounts);
  positions.forEach((position, key) => { position.x = columnX.get(columns.get(key)); });
  const result = ctx.materializeFixedEdgeRoutes(plan.edges, positions, columnX);
  // Check the actual SVG segments against every unrelated measured node rectangle.
  for (const edge of result) {
    const numbers = edge.path.match(/-?\d+(?:\.\d+)?/g).map(Number);
    const points = Array.from({ length: numbers.length / 2 }, (_, index) => numbers.slice(index * 2, index * 2 + 2));
    for (const node of nodes.filter(node => node.id !== edge.from && node.id !== edge.to)) {
      const p = positions.get(node.id), size = sizes.get(node.id);
      for (let index = 1; index < points.length; index += 1) {
        const [ax, ay] = points[index - 1], [bx, by] = points[index];
        const intersects = ax === bx
          ? ax > p.x && ax < p.x + size.width && Math.max(ay, by) > p.y && Math.min(ay, by) < p.y + size.height
          : ay > p.y && ay < p.y + size.height && Math.max(ax, bx) > p.x && Math.min(ax, bx) < p.x + size.width;
        assert.equal(intersects, false, `${edge.from} -> ${edge.to} crosses ${node.id}: ${edge.path}`);
      }
    }
  }
  return { edges: result, hints, positions, plan };
}

for (const field of ['next', 'fail', 'optionIds']) {
  for (const [fromColumn, toColumn] of [[0, 1], [2, 0]]) {
    test(`unobstructed ${field} downward from column ${fromColumn} to ${toColumn} drops at target centre`, () => {
      const result = route([{ id: 'a', column: fromColumn, y: 0 }, { id: 'b', column: toColumn, y: 300 }],
        [{ from: 'a', to: 'b', field, label: 'branch', color: '#aabbcc' }]);
      const edge = result.edges[0];
      assert.equal(edge.forwardCross, true);
      assert.equal(edge.routeX, undefined);
      assert.equal(edge.minX, Math.min(edge.startX, edge.endX));
      assert.equal(edge.maxX, Math.max(edge.startX, edge.endX));
      assert.match(edge.path, new RegExp(`L ${edge.endX} ${edge.exitY} L ${edge.endX} ${edge.endY}$`));
      assert.equal(edge.label, 'branch'); assert.equal(edge.color, '#aabbcc');
      assert.ok(Number.isFinite(edge.labelX) && Number.isFinite(edge.labelY));
      assert.equal(result.plan.leftCounts.size + result.plan.rightCounts.size, 0);
    });
  }
}

test('same-column downward failure edge stays straight when unobstructed', () => {
  const { edges } = route([{ id: 'a', column: 0, y: 0 }, { id: 'b', column: 0, y: 300 }], [{ from: 'a', to: 'b', field: 'fail' }]);
  assert.equal(edges[0].directDown, true);
});

for (const fromColumn of [0, 1]) {
  test(`a long forward jump from column ${fromColumn} avoids an intermediate target-column node`, () => {
    const { edges, hints } = route([{ id: 'a', column: fromColumn, y: 0 }, { id: 'block', column: 0, y: 300, height: 190 }, { id: 'b', column: 0, y: 600 }], [{ from: 'a', to: 'b', field: 'next' }]);
    assert.equal(edges[0].directDown, false);
    assert.ok(Number.isFinite(edges[0].routeX));
    assert.equal(hints.exitLanes.size, 1);
  });
}

test('a node in an unrelated column does not force a forward detour', () => {
  const { edges } = route([{ id: 'a', column: 0, y: 0 }, { id: 'other', column: 1, y: 300 }, { id: 'b', column: 2, y: 600 }], [{ from: 'a', to: 'b', field: 'next' }]);
  assert.equal(edges[0].forwardCross, true);
});

test('backward and self edges retain exterior lanes', () => {
  const { edges } = route([{ id: 'a', column: 0, y: 0 }, { id: 'middle', column: 0, y: 300 }, { id: 'b', column: 1, y: 600 }],
    [{ from: 'b', to: 'a', field: 'next' }, { from: 'a', to: 'a', field: 'fail' }]);
  assert.ok(edges.every(edge => !edge.directDown && !edge.forwardCross && Number.isFinite(edge.routeX)));
});

test('fan-out preserves a shared source trunk and separates horizontal branch lanes', () => {
  const { edges } = route([{ id: 'a', column: 0, y: 0 }, { id: 'b', column: 1, y: 300 }, { id: 'c', column: 2, y: 300 }],
    [{ from: 'a', to: 'b', field: 'optionIds' }, { from: 'a', to: 'c', field: 'optionIds' }]);
  assert.ok(edges.every(edge => edge.forwardCross));
  assert.notEqual(edges[0].exitY, edges[1].exitY);
});

test('unrelated coincident line segments are obstacles but a real shared trunk is permitted', () => {
  const ctx = runtime();
  const points = [[0, 120], [0, 150], [2, 150], [2, 400]];
  const occupied = [{ edge: { from: 'x', to: 'y' }, points: [[1, 80], [1, 150], [3, 150], [3, 400]] }];
  assert.equal(ctx.fixedRouteOverlapsEdges(points, { from: 'a', to: 'b' }, occupied), true);
  assert.equal(ctx.fixedRouteOverlapsEdges([[0, 120], [0, 180], [3, 180], [3, 400]], { from: 'a', to: 'c' }, [{ edge: { from: 'a', to: 'b' }, points }]), false);
});
