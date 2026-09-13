(function installGraphComponent(root) {
  'use strict';

  const NODE_WIDTH = 260;
  const NODE_HEIGHT = 142;
  const COLUMN_GAP = 130;
  const ROW_GAP = 48;
  const MARGIN = 48;
  const MIN_SCALE = 0.05;
  const MAX_SCALE = 2.5;
  const TONES = new Set(['neutral', 'success', 'warning', 'danger', 'active']);
  let instanceSequence = 0;
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

  function normalizeGraph(nodes = [], edges = []) {
    if (!Array.isArray(nodes) || !Array.isArray(edges)) throw new TypeError('Graph nodes and edges must be arrays.');
    const ids = new Set();
    const normalizedNodes = nodes.map((node) => {
      const id = String(node?.id ?? '');
      if (!id || ids.has(id)) throw new Error(`Graph node id is empty or duplicated: ${id}`);
      ids.add(id);
      return {
        id, title: String(node.title ?? id), subtitle: String(node.subtitle ?? ''),
        tone: TONES.has(node.tone) ? node.tone : 'neutral',
        badges: Array.isArray(node.badges) ? node.badges.map(String) : []
      };
    }).sort((a, b) => compare(a.id, b.id));
    const edgeIds = new Set();
    const normalizedEdges = edges.map((edge) => {
      const id = String(edge?.id ?? '');
      if (!id || edgeIds.has(id)) throw new Error(`Graph edge id is empty or duplicated: ${id}`);
      edgeIds.add(id);
      return {
        id, source: String(edge.source ?? ''), target: String(edge.target ?? ''),
        label: String(edge.label ?? ''), kind: String(edge.kind ?? '')
      };
    }).sort((a, b) => compare(a.id, b.id));
    return { nodes: normalizedNodes, edges: normalizedEdges };
  }

  // Iterative SCC discovery avoids recursion limits; longest-path ranks on its
  // condensation DAG place a join strictly after every predecessor.
  function computeGraphLayout(nodes = [], edges = [], mode = 'dag') {
    if (mode !== 'dag' && mode !== 'relations') throw new Error(`Unknown graph layout: ${mode}`);
    const graph = normalizeGraph(nodes, edges);
    const outgoing = new Map(graph.nodes.map((node) => [node.id, []]));
    const incoming = new Map(graph.nodes.map((node) => [node.id, []]));
    const validEdges = graph.edges.filter((edge) => outgoing.has(edge.source) && outgoing.has(edge.target));
    validEdges.forEach((edge) => { outgoing.get(edge.source).push(edge.target); incoming.get(edge.target).push(edge.source); });
    for (const map of [outgoing, incoming]) for (const [id, values] of map) map.set(id, [...new Set(values)].sort(compare));
    const visited = new Set();
    const order = [];
    for (const node of graph.nodes) {
      if (visited.has(node.id)) continue;
      visited.add(node.id);
      const stack = [{ id: node.id, next: 0 }];
      while (stack.length) {
        const frame = stack[stack.length - 1];
        const adjacent = outgoing.get(frame.id);
        if (frame.next >= adjacent.length) { order.push(frame.id); stack.pop(); continue; }
        const next = adjacent[frame.next++];
        if (!visited.has(next)) { visited.add(next); stack.push({ id: next, next: 0 }); }
      }
    }
    const componentOf = new Map();
    const components = [];
    for (let index = order.length - 1; index >= 0; index -= 1) {
      const id = order[index];
      if (componentOf.has(id)) continue;
      const members = [];
      const component = components.length;
      const stack = [id];
      componentOf.set(id, component);
      while (stack.length) {
        const current = stack.pop();
        members.push(current);
        for (const next of incoming.get(current)) {
          if (!componentOf.has(next)) { componentOf.set(next, component); stack.push(next); }
        }
      }
      components.push(members.sort(compare));
    }
    const successors = components.map(() => new Set());
    const indegree = components.map(() => 0);
    const ranks = components.map(() => 0);
    for (const edge of validEdges) {
      const from = componentOf.get(edge.source);
      const to = componentOf.get(edge.target);
      if (from !== to && !successors[from].has(to)) { successors[from].add(to); indegree[to] += 1; }
    }
    const queue = components.map((_, index) => index).filter((index) => indegree[index] === 0);
    for (let index = 0; index < queue.length; index += 1) {
      const current = queue[index];
      for (const next of successors[current]) {
        ranks[next] = Math.max(ranks[next], ranks[current] + 1);
        if (--indegree[next] === 0) queue.push(next);
      }
    }
    const cycles = components.filter((members) => members.length > 1
      || outgoing.get(members[0]).includes(members[0]));
    const cycleIds = new Set(cycles.flat());
    const rows = new Map();
    const positions = graph.nodes.map((node) => {
      const rank = ranks[componentOf.get(node.id)];
      const row = rows.get(rank) || 0;
      rows.set(rank, row + 1);
      return { ...node, rank, row, cyclic: cycleIds.has(node.id),
        x: MARGIN + rank * (NODE_WIDTH + COLUMN_GAP), y: MARGIN + row * (NODE_HEIGHT + ROW_GAP),
        width: NODE_WIDTH, height: NODE_HEIGHT };
    });
    const byId = new Map(positions.map((node) => [node.id, node]));
    const pairs = new Map();
    const routedEdges = validEdges.map((edge) => {
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      // Share lanes between reverse edges so a relationship cycle does not draw
      // both directions on exactly the same curve.
      const pair = JSON.stringify([edge.source, edge.target].sort(compare));
      const lane = pairs.get(pair) || 0;
      pairs.set(pair, lane + 1);
      let route;
      let labelX;
      let labelY;
      const x = source.x + NODE_WIDTH;
      const y = source.y + NODE_HEIGHT / 2;
      const targetY = target.y + NODE_HEIGHT / 2;
      if (source.id === target.id) {
        const bend = x + 60 + lane * 18;
        route = `M ${x} ${y - 30} C ${bend} ${y - 65}, ${bend} ${y + 65}, ${x} ${y + 30}`;
        labelX = bend; labelY = y;
      } else if (source.rank === target.rank) {
        const bend = x + 60 + lane * 32;
        route = `M ${x} ${y} C ${bend} ${y}, ${bend} ${targetY}, ${x} ${targetY}`;
        labelX = x + (bend - x) * 0.7; labelY = y + (targetY - y) * 0.35 - 6;
      } else {
        const endX = target.x;
        const middle = (x + endX) / 2 + lane * 14;
        route = `M ${x} ${y} C ${middle} ${y}, ${middle} ${targetY}, ${endX} ${targetY}`;
        labelX = middle; labelY = (y + targetY) / 2 - 7;
      }
      return { ...edge, path: route, labelX, labelY };
    });
    return {
      nodes: positions, edges: routedEdges, cycles,
      missingEdges: graph.edges.filter((edge) => !byId.has(edge.source) || !byId.has(edge.target)),
      width: routedEdges.reduce((size, edge) => Math.max(size, edge.labelX + MARGIN),
        positions.reduce((size, node) => Math.max(size, node.x + NODE_WIDTH + MARGIN + 100), 400)),
      height: positions.reduce((size, node) => Math.max(size, node.y + NODE_HEIGHT + MARGIN), 250)
    };
  }

  const STYLE = `
.fwe-graph-component{box-sizing:border-box;position:relative;display:flex;flex-direction:column;width:100%;height:100%;min-height:320px;overflow:hidden;border:1px solid var(--fg-line,#a8b5c7);border-radius:10px;background:var(--fg-bg,#f7f9fc);color:var(--fg-text,#17263d);font:13px/1.4 system-ui,sans-serif}
.fwe-graph-component *{box-sizing:border-box}.fwe-graph-component .fg-toolbar{display:flex;align-items:center;gap:6px;min-height:42px;padding:6px 10px;border-bottom:1px solid var(--fg-line,#a8b5c7);flex-shrink:0}.fwe-graph-component .fg-toolbar button{background:var(--fg-card,#fff);color:var(--fg-text,#17263d);border:1px solid var(--fg-line,#a8b5c7);border-radius:5px;min-width:32px;min-height:28px;cursor:pointer;font:inherit;padding:3px 8px}.fwe-graph-component .fg-status{margin-left:auto;color:var(--fg-muted,#65758d);font-size:12px;overflow-wrap:anywhere}.fwe-graph-component .fg-viewport{position:relative;flex:1;min-height:260px;overflow:hidden;touch-action:none;cursor:grab;background-image:radial-gradient(var(--fg-line,#a8b5c7) .65px,transparent .65px);background-size:20px 20px}.fwe-graph-component .fg-viewport.is-panning{cursor:grabbing}.fwe-graph-component .fg-world{position:absolute;left:0;top:0;transform-origin:0 0}.fwe-graph-component .fg-edges{position:absolute;left:0;top:0;overflow:visible;pointer-events:none}.fwe-graph-component .fg-edge path{fill:none;stroke:var(--fg-line,#a8b5c7);stroke-width:2}.fwe-graph-component .fg-edge text{fill:var(--fg-muted,#65758d);font:12px system-ui,sans-serif;paint-order:stroke;stroke:var(--fg-bg,#f7f9fc);stroke-width:5px;stroke-linejoin:round}.fwe-graph-component .fg-edge.is-related path{stroke:var(--fg-active,#247ad6);stroke-width:3}.fwe-graph-component.has-selection .fg-edge:not(.is-related){opacity:.3}.fwe-graph-component .fg-node{position:absolute;display:flex;flex-direction:column;align-items:stretch;justify-content:flex-start;gap:7px;text-align:left;padding:14px;border:1.5px solid var(--fg-line,#a8b5c7);border-left:5px solid var(--fg-line,#a8b5c7);border-radius:9px;background:var(--fg-card,#fff);color:var(--fg-text,#17263d);box-shadow:0 2px 6px #1220390c;cursor:pointer;font:inherit;overflow:hidden}.fwe-graph-component .fg-node:focus-visible,.fwe-graph-component button:focus-visible,.fwe-graph-component .fg-viewport:focus-visible{outline:3px solid var(--fg-active,#247ad6);outline-offset:3px}.fwe-graph-component .fg-node-title{font-size:15px;font-weight:650;line-height:20px;min-height:20px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}.fwe-graph-component .fg-node-subtitle{font-size:12px;line-height:17px;color:var(--fg-muted,#65758d);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;overflow-wrap:anywhere}.fwe-graph-component .fg-badges{display:flex;gap:5px;margin-top:auto;min-height:18px;overflow:hidden}.fwe-graph-component .fg-badge{font-size:10px;line-height:16px;padding:1px 5px;border-radius:4px;background:var(--fg-bg,#f7f9fc);color:var(--fg-muted,#65758d);max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.fwe-graph-component .fg-node.fg-tone-success{border-left-color:#27966a}.fwe-graph-component .fg-node.fg-tone-warning{border-left-color:#bd8823}.fwe-graph-component .fg-node.fg-tone-danger{border-left-color:#cf5058}.fwe-graph-component .fg-node.fg-tone-active{border-left-color:var(--fg-active,#247ad6)}.fwe-graph-component .fg-node.is-selected{outline:3px solid var(--fg-active,#247ad6);outline-offset:2px}.fwe-graph-component .fg-node.is-upstream,.fwe-graph-component .fg-node.is-downstream{border-color:var(--fg-active,#247ad6)}.fwe-graph-component.has-selection .fg-node[data-relation=unrelated]{opacity:.55}.fwe-graph-component .fg-empty{position:absolute;inset:0;display:grid;place-items:center;color:var(--fg-muted,#65758d);padding:24px;text-align:center;pointer-events:none}.fwe-graph-component .fg-empty[hidden]{display:none}
`;

  function createGraph(options = {}) {
    const host = options.host;
    if (!host || !host.ownerDocument || typeof host.append !== 'function') throw new TypeError('createGraph requires a DOM host.');
    const document = host.ownerDocument;
    const view = document.defaultView || root;
    const mode = options.layout || 'dag';
    let graph = normalizeGraph(options.nodes || [], options.edges || []);
    let layout = computeGraphLayout(graph.nodes, graph.edges, mode);
    let selectedId = options.selectedId == null ? '' : String(options.selectedId);
    let onSelect = typeof options.onSelect === 'function' ? options.onSelect : null;
    let destroyed = false;
    let autoFit = true;
    let transform = { x: 0, y: 0, scale: 1 };
    let pan = null;
    let nodeElements = new Map();
    let edgeElements = new Map();
    const listeners = [];
    const markerId = `fwe-graph-arrow-${++instanceSequence}`;
    const element = (tag, className, text) => {
      const el = document.createElement(tag);
      if (className) el.className = className;
      if (text !== undefined) el.textContent = text;
      return el;
    };
    const svgElement = (tag, attributes = {}) => {
      const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [key, value] of Object.entries(attributes)) el.setAttribute(key, String(value));
      return el;
    };
    const listen = (target, type, handler, config) => {
      target.addEventListener(type, handler, config);
      listeners.push(() => target.removeEventListener(type, handler, config));
    };
    const container = element('div', 'fwe-graph-component');
    container.setAttribute('role', 'region');
    container.setAttribute('aria-label', 'Read-only graph');
    const style = element('style', '', STYLE);
    const toolbar = element('div', 'fg-toolbar');
    const viewport = element('div', 'fg-viewport');
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'group');
    viewport.setAttribute('aria-label', 'Graph canvas. Arrow keys select nodes; plus and minus zoom; 0 fits.');
    const world = element('div', 'fg-world');
    const status = element('span', 'fg-status');
    status.setAttribute('role', 'status');
    const empty = element('div', 'fg-empty', 'No nodes to display');
    viewport.append(world, empty);
    const zoomOut = element('button', '', '−');
    const zoomIn = element('button', '', '+');
    const fitButton = element('button', '', 'Fit');
    for (const [button, label] of [[zoomOut, 'Zoom out'], [zoomIn, 'Zoom in'], [fitButton, 'Fit graph']]) {
      button.type = 'button'; button.setAttribute('aria-label', label);
    }
    toolbar.append(zoomOut, zoomIn, fitButton, status);
    container.append(style, toolbar, viewport);
    host.append(container);

    function metrics() { return { width: viewport.clientWidth || host.clientWidth || 640, height: viewport.clientHeight || 360 }; }
    function applyTransform() { world.style.transform = `translate(${transform.x}px, ${transform.y}px) scale(${transform.scale})`; }
    function fit() {
      if (destroyed) return;
      autoFit = true;
      const size = metrics();
      const scale = Math.min(1, Math.max(MIN_SCALE, Math.min((size.width - 24) / layout.width, (size.height - 24) / layout.height)));
      transform = { scale, x: (size.width - layout.width * scale) / 2, y: (size.height - layout.height * scale) / 2 };
      applyTransform();
    }
    function zoom(factor, point = null) {
      if (destroyed) return;
      autoFit = false;
      const size = metrics();
      const center = point || { x: size.width / 2, y: size.height / 2 };
      const scale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, transform.scale * factor));
      transform = { scale, x: center.x - (center.x - transform.x) * scale / transform.scale,
        y: center.y - (center.y - transform.y) * scale / transform.scale };
      applyTransform();
    }
    function reachable(id, reverse) {
      const adjacency = new Map(layout.nodes.map((node) => [node.id, []]));
      for (const edge of layout.edges) adjacency.get(reverse ? edge.target : edge.source).push(reverse ? edge.source : edge.target);
      const reached = new Set();
      const queue = [id];
      for (let index = 0; index < queue.length; index += 1) {
        for (const next of adjacency.get(queue[index]) || []) {
          if (next !== id && !reached.has(next)) { reached.add(next); queue.push(next); }
        }
      }
      return reached;
    }
    function paintSelection() {
      if (!nodeElements.has(selectedId)) selectedId = '';
      const upstream = reachable(selectedId, true);
      const downstream = reachable(selectedId, false);
      container.classList.toggle('has-selection', !!selectedId);
      const focusId = selectedId || layout.nodes[0]?.id;
      for (const [id, button] of nodeElements) {
        button.classList.toggle('is-selected', id === selectedId);
        button.classList.toggle('is-upstream', upstream.has(id));
        button.classList.toggle('is-downstream', downstream.has(id));
        button.dataset.relation = id === selectedId ? 'selected' : upstream.has(id) && downstream.has(id) ? 'both'
          : upstream.has(id) ? 'upstream' : downstream.has(id) ? 'downstream' : 'unrelated';
        button.setAttribute('aria-pressed', String(id === selectedId));
        button.tabIndex = id === focusId ? 0 : -1;
      }
      for (const edge of layout.edges) {
        const sourceUp = upstream.has(edge.source) || edge.source === selectedId;
        const targetUp = upstream.has(edge.target) || edge.target === selectedId;
        const sourceDown = downstream.has(edge.source) || edge.source === selectedId;
        const targetDown = downstream.has(edge.target) || edge.target === selectedId;
        edgeElements.get(edge.id).classList.toggle('is-related', !!selectedId && ((sourceUp && targetUp) || (sourceDown && targetDown)));
      }
    }
    function select(id, notify = false) {
      if (destroyed) return;
      const next = id == null ? '' : String(id);
      const value = nodeElements.has(next) ? next : '';
      const changed = selectedId !== value;
      selectedId = value;
      paintSelection();
      if (notify && changed && onSelect) onSelect(selectedId || null);
    }
    function reveal(id) {
      const node = layout.nodes.find((candidate) => candidate.id === id);
      if (!node) return;
      const size = metrics();
      const left = node.x * transform.scale + transform.x;
      const top = node.y * transform.scale + transform.y;
      const right = left + NODE_WIDTH * transform.scale;
      const bottom = top + NODE_HEIGHT * transform.scale;
      if (left < 12 || right > size.width - 12 || top < 12 || bottom > size.height - 12) {
        autoFit = false;
        transform.x = size.width / 2 - (node.x + NODE_WIDTH / 2) * transform.scale;
        transform.y = size.height / 2 - (node.y + NODE_HEIGHT / 2) * transform.scale;
        applyTransform();
      }
      nodeElements.get(id)?.focus({ preventScroll: true });
    }
    function render() {
      const previousFocus = world.contains(document.activeElement) ? document.activeElement?.dataset?.nodeId : null;
      world.replaceChildren();
      nodeElements = new Map(); edgeElements = new Map();
      world.style.width = `${layout.width}px`; world.style.height = `${layout.height}px`;
      const svg = svgElement('svg', { class: 'fg-edges', width: layout.width, height: layout.height, 'aria-hidden': 'true' });
      const defs = svgElement('defs');
      const marker = svgElement('marker', { id: markerId, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: 'auto' });
      marker.append(svgElement('path', { d: 'M 0 0 L 10 5 L 0 10 Z', fill: 'var(--fg-line,#a8b5c7)' }));
      defs.append(marker); svg.append(defs);
      for (const edge of layout.edges) {
        const group = svgElement('g', { class: 'fg-edge', 'data-edge-id': edge.id });
        group.append(svgElement('path', { d: edge.path, 'marker-end': `url(#${markerId})` }));
        const title = svgElement('title'); title.textContent = edge.label || `${edge.source} → ${edge.target}`; group.append(title);
        if (edge.label) {
          const label = svgElement('text', { x: edge.labelX, y: edge.labelY, 'text-anchor': 'middle' });
          label.textContent = edge.label.length > 36 ? `${edge.label.slice(0, 35)}…` : edge.label; group.append(label);
        }
        svg.append(group); edgeElements.set(edge.id, group);
      }
      world.append(svg);
      for (const node of layout.nodes) {
        const button = element('button', `fg-node fg-tone-${node.tone}`);
        button.type = 'button'; button.dataset.nodeId = node.id; button.dataset.cyclic = String(node.cyclic);
        button.style.left = `${node.x}px`; button.style.top = `${node.y}px`;
        button.style.width = `${NODE_WIDTH}px`; button.style.height = `${NODE_HEIGHT}px`;
        button.title = [node.title, node.subtitle, ...node.badges].filter(Boolean).join('\n');
        button.setAttribute('aria-label', [node.title, node.subtitle, ...node.badges].filter(Boolean).join('. '));
        button.append(element('span', 'fg-node-title', node.title));
        if (node.subtitle) button.append(element('span', 'fg-node-subtitle', node.subtitle));
        const badges = element('span', 'fg-badges');
        node.badges.slice(0, 3).forEach((badge) => badges.append(element('span', 'fg-badge', badge)));
        if (node.badges.length > 3) badges.append(element('span', 'fg-badge', `+${node.badges.length - 3}`));
        button.append(badges); world.append(button); nodeElements.set(node.id, button);
      }
      empty.hidden = layout.nodes.length > 0;
      status.textContent = `${layout.nodes.length} nodes · ${layout.edges.length} edges`
        + (layout.cycles.length ? ` · ${layout.cycles.length} cycle groups${mode === 'dag' ? ' (not a DAG)' : ''}` : '')
        + (layout.missingEdges.length ? ` · ${layout.missingEdges.length} unresolved edges` : '');
      paintSelection();
      if (autoFit) fit(); else applyTransform();
      if (previousFocus && nodeElements.has(previousFocus)) nodeElements.get(previousFocus).focus({ preventScroll: true });
    }
    function keyboard(event) {
      const currentId = event.target.closest?.('[data-node-id]')?.dataset.nodeId;
      const keys = ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'];
      if (keys.includes(event.key) && layout.nodes.length) {
        event.preventDefault();
        const ordered = [...layout.nodes].sort((a, b) => a.rank - b.rank || a.row - b.row || compare(a.id, b.id));
        const current = layout.nodes.find((node) => node.id === (currentId || selectedId)) || ordered[0];
        let next = event.key === 'Home' ? ordered[0] : event.key === 'End' ? ordered[ordered.length - 1] : null;
        if (!next) {
          const horizontal = event.key === 'ArrowLeft' || event.key === 'ArrowRight';
          const sign = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
          next = layout.nodes.map((node) => ({ node,
            distance: (horizontal ? node.x - current.x : node.y - current.y) * sign,
            offset: Math.abs(horizontal ? node.y - current.y : node.x - current.x) }))
            .filter((candidate) => candidate.distance > 0)
            .sort((a, b) => a.distance + a.offset * 2 - b.distance - b.offset * 2 || compare(a.node.id, b.node.id))[0]?.node || current;
        }
        select(next.id, true); reveal(next.id);
      } else if (event.key === 'Escape') { event.preventDefault(); select(null, true); }
      else if (event.key === '+' || event.key === '=') { event.preventDefault(); zoom(1.2); }
      else if (event.key === '-') { event.preventDefault(); zoom(1 / 1.2); }
      else if (event.key === '0') { event.preventDefault(); fit(); }
    }
    listen(viewport, 'click', (event) => {
      const node = event.target.closest?.('[data-node-id]');
      if (node && world.contains(node)) select(node.dataset.nodeId, true);
    });
    listen(viewport, 'keydown', keyboard);
    listen(zoomOut, 'click', () => zoom(1 / 1.2));
    listen(zoomIn, 'click', () => zoom(1.2));
    listen(fitButton, 'click', fit);
    listen(viewport, 'wheel', (event) => {
      event.preventDefault();
      const box = viewport.getBoundingClientRect();
      zoom(Math.exp(-Math.max(-100, Math.min(100, event.deltaY)) * 0.003), { x: event.clientX - box.left, y: event.clientY - box.top });
    }, { passive: false });
    listen(viewport, 'pointerdown', (event) => {
      if ((event.button !== 0 && event.button !== 1) || event.target.closest?.('[data-node-id]')) return;
      event.preventDefault(); autoFit = false;
      pan = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, originX: transform.x, originY: transform.y };
      viewport.setPointerCapture?.(event.pointerId); viewport.classList.add('is-panning');
    });
    listen(viewport, 'pointermove', (event) => {
      if (!pan || event.pointerId !== pan.pointerId) return;
      transform.x = pan.originX + event.clientX - pan.x; transform.y = pan.originY + event.clientY - pan.y; applyTransform();
    });
    function endPan() {
      if (pan && viewport.hasPointerCapture?.(pan.pointerId)) viewport.releasePointerCapture(pan.pointerId);
      pan = null; viewport.classList.remove('is-panning');
    }
    listen(viewport, 'pointerup', endPan); listen(viewport, 'pointercancel', endPan); listen(viewport, 'lostpointercapture', endPan);
    const resize = () => { if (autoFit && !destroyed) fit(); };
    const observer = typeof view.ResizeObserver === 'function' ? new view.ResizeObserver(resize) : null;
    if (observer) observer.observe(viewport); else listen(view, 'resize', resize);
    render();
    return {
      update(patch = {}) {
        if (destroyed) return;
        const next = normalizeGraph(patch.nodes === undefined ? graph.nodes : patch.nodes, patch.edges === undefined ? graph.edges : patch.edges);
        const nextLayout = computeGraphLayout(next.nodes, next.edges, mode);
        graph = next; layout = nextLayout;
        if (Object.prototype.hasOwnProperty.call(patch, 'selectedId')) selectedId = patch.selectedId == null ? '' : String(patch.selectedId);
        render();
      },
      select(id) { select(id); }, fit,
      destroy() {
        if (destroyed) return;
        destroyed = true; endPan(); observer?.disconnect(); listeners.forEach((remove) => remove());
        onSelect = null; nodeElements.clear(); edgeElements.clear(); container.remove();
      }
    };
  }

  root.createFweGraph = createGraph;
  if (typeof module === 'object' && module.exports) module.exports = { computeGraphLayout, createGraph };
}(typeof window === 'undefined' ? globalThis : window));
