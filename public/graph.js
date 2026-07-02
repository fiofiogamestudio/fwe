// Graph rendering, route-lane layout, free layout, and blueprint helpers.
// Loaded before app.js; these functions intentionally live in the browser global scope.

function isDialogGraphProfile() {
  if (state.domain?.kind !== 'graph') {
    return false;
  }
  const profile = String(state.domain.graph?.profile || state.domain.graph?.adapter || '').trim().toLowerCase();
  return profile === 'dialog' || profile === 'dialog-editor';
}

function getGraphProfileConfig() {
  const profile = String(state.domain?.graph?.profile || state.domain?.graph?.adapter || '').trim().toLowerCase();
  return {
    ...(BUILT_IN_GRAPH_PROFILES[profile] || {}),
    ...(state.domain?.graph?.profileConfig || {})
  };
}

function getGraphKindLabels() {
  return state.domain?.graph?.kindLabels || getGraphProfileConfig().kindLabels || {};
}

function showGraphContextMenu(x, y, nodeKey) {
  if (!isDialogGraphProfile() || !nodeKey) {
    return;
  }
  const graph = buildGraphModel();
  const node = graph.nodeMap.get(nodeKey);
  if (!node || isVirtualGraphNode(node)) {
    return;
  }

  state.contextGraphNodeKey = nodeKey;
  state.selectedKey = nodeKey;
  state.selectedEdge = null;
  resetJsonDraftState();
  renderDialogGraphContextMenu(node, graph);
  renderInspector();
  renderGraph();
  graphContextMenu.classList.remove('hidden');
  graphContextMenu.style.left = `${x + 6}px`;
  graphContextMenu.style.top = `${y + 6}px`;
  updateActionButtons();
}

function hideGraphContextMenu() {
  graphContextMenu.classList.add('hidden');
  state.contextGraphNodeKey = '';
}

function renderDialogGraphContextMenu(node, graph) {
  graphContextMenu.innerHTML = '';
  const kind = Number(node.value?.kind);
  const appendGroup = (title, action) => {
    const group = document.createElement('div');
    group.className = 'context-menu__group';
    const heading = document.createElement('div');
    heading.className = 'context-menu__title';
    heading.textContent = title;
    group.append(heading);

    getDialogKindOptions().forEach((item) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.action = action;
      button.dataset.kind = String(item.value);
      button.textContent = `${title} ${item.label}`.trim();
      group.append(button);
    });
    graphContextMenu.append(group);
  };

  if (node.collection !== graph.baseCollection) {
    appendGroup(getGraphLabel('contextAddNext', '添加后续'), 'add-next');
  } else if (kind === 1) {
    appendGroup(getGraphLabel('contextAddOption', '添加选项分支'), 'add-branch');
  } else if (kind === 2 || kind === 4) {
    appendGroup(getGraphLabel('contextAddNext', '添加后续'), 'add-next');
    appendGroup(getGraphLabel('contextAddFail', '添加失败分支'), 'add-branch');
  } else if (kind !== 5) {
    appendGroup(getGraphLabel('contextAddNext', '添加后续'), 'add-next');
  }

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.dataset.action = 'delete-node';
  remove.className = 'danger';
  remove.textContent = node.collection === graph.baseCollection
    ? getGraphLabel('contextDeleteNode', '删除节点')
    : getGraphLabel('contextDeleteOption', '删除选项');
  graphContextMenu.append(remove);
}

function runGraphContextAction(action, kind) {
  if (!isDialogGraphProfile()) {
    return;
  }
  const graph = buildGraphModel();
  const node = graph.nodeMap.get(state.contextGraphNodeKey || state.selectedKey);
  if (!node || isVirtualGraphNode(node)) {
    hideGraphContextMenu();
    return;
  }

  if (action === 'add-next') {
    if (node.collection === graph.baseCollection) {
      addDialogNextNode(node.id, kind);
    } else {
      addDialogNextFromOption(node.id, kind);
    }
  } else if (action === 'add-branch') {
    if (node.collection === graph.baseCollection) {
      addDialogBranchNode(node.id, kind);
    }
  } else if (action === 'delete-node') {
    if (node.collection === graph.baseCollection) {
      deleteDialogNode(node.id);
    } else {
      deleteDialogOption(node.id);
    }
  }

  hideGraphContextMenu();
}

function getDialogKindOptions() {
  return Object.entries(getGraphKindLabels()).map(([value, label]) => ({
    value: Number(value),
    label
  }));
}

function getDialogNodes() {
  return ensureArray(getByPath(state.data, state.domain.graph?.nodes || 'nodes'));
}

function getDialogOptions() {
  const pathText = state.domain.graph?.options || state.domain.model?.options || 'options';
  return ensureArray(getByPath(state.data, pathText));
}

function findDialogNode(id) {
  return getDialogNodes().find((node) => String(node?.id) === String(id)) || null;
}

function findDialogOption(id) {
  return getDialogOptions().find((option) => String(option?.id) === String(id)) || null;
}

function getDialogActor(actorId) {
  const actors = ensureArray(getByPath(state.data, state.domain.graph?.actors || 'meta.actors'));
  return actors.find((actor) => String(actor?.actorId || actor?.id || '') === String(actorId || '')) || null;
}

function getDefaultDialogActorId(side) {
  const actors = ensureArray(getByPath(state.data, state.domain.graph?.actors || 'meta.actors'));
  const match = actors.find((actor) => Number(actor?.side) === side) || actors[0];
  return String(match?.actorId || match?.id || '');
}

function createDialogNode(kind = 0, actorId = '') {
  const normalizedKind = normalizeDialogKind(kind);
  const node = {
    id: getNextNumericId(getDialogNodes(), state.domain.graph?.nodeId || 'id'),
    kind: normalizedKind
  };

  if (normalizedKind === 0 || normalizedKind === 1) {
    const actor = getDialogActor(actorId);
    node.actorId = actorId || '';
    node.face = actor?.faces?.[0] || '';
    node.text = '';
  }
  if (normalizedKind === 1) {
    node.optionIds = [];
  }
  if (normalizedKind === 2) {
    node.conds = [];
  }
  if (normalizedKind === 3) {
    node.acts = [];
  }
  if (normalizedKind === 4) {
    node.hook = '';
    node.arg = '';
    node.wait = false;
  }
  if (normalizedKind !== 1 && normalizedKind !== 5) {
    node.next = 0;
  }
  if (normalizedKind === 2 || normalizedKind === 4) {
    node.fail = 0;
  }
  return node;
}

function createDialogOption(actorId = '', next = 0) {
  const actor = getDialogActor(actorId);
  return {
    id: getNextNumericId(getDialogOptions(), 'id'),
    actorId: actorId || '',
    face: actor?.faces?.[0] || '',
    color: 'neutral',
    text: '',
    next: next || 0,
    conds: [],
    acts: []
  };
}

function normalizeDialogKind(kind) {
  const value = Number(kind);
  return Object.prototype.hasOwnProperty.call(getGraphKindLabels(), value) ? value : 0;
}

function selectDialogGraphNode(collection, id) {
  state.selectedKey = `${collection}:${id}`;
  state.selectedEdge = null;
  resetJsonDraftState();
}

function addDialogNextNode(nodeId, kind = 0) {
  const node = findDialogNode(nodeId);
  if (!node) {
    return;
  }
  if (Number(node.kind) === 1) {
    addDialogBranchNode(nodeId, kind);
    return;
  }

  const nodes = getDialogNodes();
  pushHistory(`从 #${node.id} 添加后续节点`);
  const created = createDialogNode(kind, node.actorId || getDefaultDialogActorId(1));
  created.next = Number(created.kind) === 5 ? 0 : (Number(node.next) || 0);
  node.next = created.id;
  nodes.push(created);
  selectDialogGraphNode(state.domain.graph?.nodes || 'nodes', created.id);
  markDirtyAndRender(`已添加节点 #${created.id}`);
}

function addDialogNextFromOption(optionId, kind = 0) {
  const option = findDialogOption(optionId);
  if (!option) {
    return;
  }

  const nodes = getDialogNodes();
  pushHistory(`从选项 #${option.id} 添加后续节点`);
  const created = createDialogNode(kind, option.actorId || getDefaultDialogActorId(1));
  created.next = Number(created.kind) === 5 ? 0 : (Number(option.next) || 0);
  option.next = created.id;
  nodes.push(created);
  selectDialogGraphNode(state.domain.graph?.nodes || 'nodes', created.id);
  markDirtyAndRender(`已添加节点 #${created.id}`);
}

function addDialogBranchNode(nodeId, kind = 0) {
  const node = findDialogNode(nodeId);
  if (!node) {
    return;
  }

  const nodes = getDialogNodes();
  const options = getDialogOptions();
  pushHistory(`从 #${node.id} 添加分支`);
  if (Number(node.kind) === 1) {
    const nextNode = createDialogNode(kind, getDefaultDialogActorId(1));
    const option = createDialogOption(getDefaultDialogActorId(0), nextNode.id);
    nodes.push(nextNode);
    options.push(option);
    node.optionIds = ensureArray(node.optionIds);
    node.optionIds.push(option.id);
    selectDialogGraphNode(state.domain.graph?.options || state.domain.model?.options || 'options', option.id);
    markDirtyAndRender(`已添加选项 #${option.id}`);
    return;
  }

  if (Number(node.kind) === 2 || Number(node.kind) === 4) {
    const failNode = createDialogNode(kind, getDefaultDialogActorId(1));
    failNode.next = Number(failNode.kind) === 5 ? 0 : (Number(node.fail) || 0);
    node.fail = failNode.id;
    nodes.push(failNode);
    selectDialogGraphNode(state.domain.graph?.nodes || 'nodes', failNode.id);
    markDirtyAndRender(`已添加失败节点 #${failNode.id}`);
    return;
  }

  state.history.undo.pop();
  addDialogNextNode(nodeId, kind);
}

function deleteDialogNode(nodeId) {
  const node = findDialogNode(nodeId);
  if (!node || !window.confirm(`删除节点 #${nodeId}？`)) {
    return;
  }

  pushHistory(`删除节点 #${nodeId}`);
  const fallback = Number(node.next) || Number(node.fail) || 0;
  getDialogNodes().forEach((item) => {
    if (String(item.id) === String(nodeId)) {
      return;
    }
    if (String(item.next) === String(nodeId)) {
      item.next = fallback;
    }
    if (String(item.fail) === String(nodeId)) {
      item.fail = 0;
    }
  });
  getDialogOptions().forEach((option) => {
    if (String(option.next) === String(nodeId)) {
      option.next = fallback;
    }
  });

  if (Number(node.kind) === 1) {
    const optionIds = new Set(ensureArray(node.optionIds).map(String));
    const keptOptions = getDialogOptions().filter((option) => !optionIds.has(String(option.id)));
    setByPath(state.data, state.domain.graph?.options || state.domain.model?.options || 'options', keptOptions);
  }

  const keptNodes = getDialogNodes().filter((item) => String(item.id) !== String(nodeId));
  setByPath(state.data, state.domain.graph?.nodes || 'nodes', keptNodes);
  const entryPath = state.domain.graph?.entry || 'entry';
  if (String(getByPath(state.data, entryPath)) === String(nodeId)) {
    setByPath(state.data, entryPath, fallback || keptNodes[0]?.id || 0);
  }

  state.selectedKey = '';
  state.selectedEdge = null;
  markDirtyAndRender(`已删除节点 #${nodeId}`);
}

function deleteDialogOption(optionId) {
  if (!findDialogOption(optionId) || !window.confirm(`删除选项 #${optionId}？`)) {
    return;
  }

  pushHistory(`删除选项 #${optionId}`);
  const keptOptions = getDialogOptions().filter((option) => String(option.id) !== String(optionId));
  setByPath(state.data, state.domain.graph?.options || state.domain.model?.options || 'options', keptOptions);
  getDialogNodes().forEach((node) => {
    if (Array.isArray(node.optionIds)) {
      node.optionIds = node.optionIds.filter((id) => String(id) !== String(optionId));
    }
  });
  state.selectedKey = '';
  state.selectedEdge = null;
  markDirtyAndRender(`已删除选项 #${optionId}`);
}

function renderGraph() {
  if (isBlueprintGraph()) {
    renderBlueprintGraph();
    return;
  }
  const graph = buildGraphModel();
  let layout = layoutGraph(graph);
  drawGraphLayout(graph, layout);

  const measuredSizes = measureRenderedGraphNodeSizes(layout.sizes);
  if (measuredSizes) {
    layout = layoutGraph(graph, measuredSizes);
    drawGraphLayout(graph, layout);
  }

  if (state.view.resetPending) {
    resetGraphView(false);
  } else {
    clampGraphView();
    applyGraphView();
  }
}

function renderBlueprintGraph(viewSpec = null) {
  const model = buildBlueprintModel(viewSpec);
  const layout = layoutBlueprintGraph(model);
  graphNodes.innerHTML = '';
  graphEdges.innerHTML = '';
  graphView.dataset.layout = 'blueprint';
  applyGraphLayoutSurface(layout);

  for (const node of layout.nodes) {
    const pos = layout.positions.get(node.key);
    if (!pos) {
      continue;
    }
    const item = document.createElement('button');
    item.type = 'button';
    item.className = getBlueprintNodeClassName(node);
    if (state.selectedKey === node.key) {
      item.classList.add('is-selected');
    }
    if (isGraphNodeHighlighted(node.key)) {
      item.classList.add('is-highlighted');
    }
    item.dataset.collection = node.collection;
    item.dataset.key = node.key;
    item.style.left = `${pos.x}px`;
    item.style.top = `${pos.y}px`;
    item.innerHTML = renderBlueprintNodeContent(node);
    item.addEventListener('click', () => {
      if (state.suppressClick) {
        return;
      }
      state.selectedKey = node.key;
      state.selectedEdge = null;
      resetJsonDraftState();
      renderInspector();
      renderBlueprintGraph(viewSpec);
      updateActionButtons();
    });
    item.addEventListener('mousedown', (event) => {
      if (event.button !== 0) {
        return;
      }
      startGraphDrag(event, node, item, pos);
    });
    graphNodes.append(item);
  }

  const measuredLayout = measureBlueprintLayout(model, layout);
  applyGraphLayoutSurface(measuredLayout);
  drawBlueprintEdges(measuredLayout);

  if (state.view.resetPending) {
    resetGraphView(false);
  } else {
    clampGraphView();
    applyGraphView();
  }
}

function isBlueprintGraph() {
  return !!state.domain?.graph?.blueprint;
}

function getBlueprintSpec(viewSpec = null) {
  const spec = state.domain?.graph?.blueprint || {};
  return {
    nodes: viewSpec?.target || spec.nodes || state.domain?.graph?.nodes || state.domain?.model?.nodes || 'nodes',
    edges: viewSpec?.edges || spec.edges || state.domain?.model?.edges || 'edges',
    nodeId: spec.nodeId || state.domain?.graph?.nodeId || 'id',
    nodeType: spec.nodeType || 'type',
    values: spec.values || 'values',
    position: spec.position || state.domain?.graph?.position || 'pos',
    types: spec.types || []
  };
}

function buildBlueprintModel(viewSpec = null) {
  const spec = getBlueprintSpec(viewSpec);
  const nodes = ensureArray(getByPath(state.data, spec.nodes));
  const edges = ensureArray(getByPath(state.data, spec.edges));
  const typeMap = new Map((spec.types || []).map((type) => [String(type.id), normalizeBlueprintNodeType(type)]));
  const nodeList = [];
  const nodeMap = new Map();
  nodes.forEach((value, index) => {
    const id = value?.[spec.nodeId] ?? index;
    const typeId = String(value?.[spec.nodeType] ?? '');
    const typeSpec = typeMap.get(typeId) || null;
    const node = {
      key: `${spec.nodes}:${id}`,
      collection: spec.nodes,
      id,
      typeId,
      typeSpec,
      title: typeSpec?.title || typeId || `Node ${id}`,
      text: String(value?.title || typeSpec?.title || typeId || ''),
      value,
      index
    };
    nodeList.push(node);
    nodeMap.set(node.key, node);
  });

  const edgeList = edges.map((value, index) => {
    const fromNodeId = getByPath(value, 'from.node');
    const toNodeId = getByPath(value, 'to.node');
    const fromPort = String(getByPath(value, 'from.port') ?? '');
    const toPort = String(getByPath(value, 'to.port') ?? '');
    const from = `${spec.nodes}:${fromNodeId}`;
    const to = `${spec.nodes}:${toNodeId}`;
    const sourceNode = nodeMap.get(from) || null;
    const targetNode = nodeMap.get(to) || null;
    const sourcePort = sourceNode ? getBlueprintPort(sourceNode, fromPort, 'output') : null;
    const targetPort = targetNode ? getBlueprintPort(targetNode, toPort, 'input') : null;
    return {
      key: value?.id || `${from}:${fromPort}->${to}:${toPort}:${index}`,
      id: value?.id || index,
      from,
      to,
      fromPort,
      toPort,
      sourceNode,
      targetNode,
      sourcePort,
      targetPort,
      value,
      index,
      field: `${spec.edges}[${index}]`,
      kind: sourcePort?.kind || targetPort?.kind || '',
      type: sourcePort?.type || targetPort?.type || '',
      label: value?.label || sourcePort?.label || ''
    };
  });

  nodeList.forEach((node) => {
    node.outgoing = edgeList.filter((edge) => edge.from === node.key);
    node.incoming = edgeList.filter((edge) => edge.to === node.key);
  });

  return {
    spec,
    nodes: nodeList,
    edges: edgeList,
    nodeMap,
    typeMap,
    baseCollection: spec.nodes,
    entry: ''
  };
}

function normalizeBlueprintNodeType(type) {
  const ports = ensureArray(type.ports).map((port) => ({
    id: String(port.id || ''),
    label: port.label || titleFromPath(port.id || ''),
    direction: port.direction === 'output' || port.direction === 'out' ? 'output' : 'input',
    kind: port.kind === 'control' || String(port.type).toLowerCase() === 'exec' ? 'control' : 'data',
    type: String(port.type || 'any'),
    default: port.default,
    multiple: !!port.multiple
  })).filter((port) => port.id);
  return {
    id: String(type.id || ''),
    title: type.title || type.label || titleFromPath(type.id || ''),
    label: type.label || type.title || titleFromPath(type.id || ''),
    color: type.color || '',
    ports,
    inputs: ports.filter((port) => port.direction === 'input'),
    outputs: ports.filter((port) => port.direction === 'output')
  };
}

function getBlueprintPort(node, portId, direction = '') {
  const ports = node.typeSpec?.ports || [];
  return ports.find((port) => port.id === portId && (!direction || port.direction === direction)) || null;
}

function layoutBlueprintGraph(model) {
  const grid = getGraphGridSize();
  const positions = new Map();
  const sizes = new Map();
  model.nodes.forEach((node, index) => {
    const saved = getNodeGridPosition(node);
    positions.set(node.key, saved
      ? { x: saved.x * grid, y: saved.y * grid }
      : { x: 80 + index * 300, y: 100 });
    sizes.set(node.key, {
      width: 280,
      height: Math.max(150, 74 + Math.max(node.typeSpec?.inputs?.length || 0, node.typeSpec?.outputs?.length || 0) * 30)
    });
  });
  const width = Math.max(1100, maxGraphExtent(positions, sizes, 'x') + FIXED_GRAPH_MARGIN);
  const height = Math.max(720, maxGraphExtent(positions, sizes, 'y') + FIXED_GRAPH_MARGIN);
  return { ...model, positions, sizes, portAnchors: new Map(), edges: model.edges, width, height };
}

function measureBlueprintLayout(model, layout) {
  const positions = new Map(layout.positions);
  const sizes = new Map(layout.sizes);
  const portAnchors = new Map();
  const stageRect = graphStage.getBoundingClientRect();
  const scale = state.view.scale || 1;
  graphNodes.querySelectorAll('.blueprint-node').forEach((item) => {
    const key = item.dataset.key;
    const pos = positions.get(key);
    if (!key || !pos) {
      return;
    }
    sizes.set(key, {
      width: item.offsetWidth || 280,
      height: item.offsetHeight || sizes.get(key)?.height || 150
    });
    item.querySelectorAll('.blueprint-port').forEach((port) => {
      const rect = port.getBoundingClientRect();
      const portKey = `${key}:${port.dataset.portDirection}:${port.dataset.portId}`;
      portAnchors.set(portKey, {
        x: (rect.left + rect.width / 2 - stageRect.left) / scale,
        y: (rect.top + rect.height / 2 - stageRect.top) / scale
      });
    });
  });
  const width = Math.max(1100, maxGraphExtent(positions, sizes, 'x') + FIXED_GRAPH_MARGIN);
  const height = Math.max(720, maxGraphExtent(positions, sizes, 'y') + FIXED_GRAPH_MARGIN);
  const edges = model.edges.map((edge) => routeBlueprintEdge(edge, portAnchors)).filter(Boolean);
  return { ...model, positions, sizes, portAnchors, edges, width, height };
}

function routeBlueprintEdge(edge, portAnchors) {
  const start = portAnchors.get(`${edge.from}:output:${edge.fromPort}`);
  const end = portAnchors.get(`${edge.to}:input:${edge.toPort}`);
  if (!start || !end) {
    return null;
  }
  const handle = Math.max(80, Math.abs(end.x - start.x) * 0.5);
  return {
    ...edge,
    startX: start.x,
    startY: start.y,
    endX: end.x,
    endY: end.y,
    labelX: (start.x + end.x) / 2,
    labelY: (start.y + end.y) / 2,
    path: `M ${start.x} ${start.y} C ${start.x + handle} ${start.y}, ${end.x - handle} ${end.y}, ${end.x} ${end.y}`
  };
}

function getBlueprintNodeClassName(node) {
  const classes = ['graph-node', 'blueprint-node'];
  if (!node.typeSpec) {
    classes.push('blueprint-node--invalid');
  }
  return classes.join(' ');
}

function renderBlueprintNodeContent(node) {
  const inputs = node.typeSpec?.inputs || [];
  const outputs = node.typeSpec?.outputs || [];
  return `
    <div class="blueprint-node__head">
      <span class="blueprint-node__title">${escapeHtml(node.typeSpec?.title || node.typeId || 'Unknown')}</span>
      <span class="blueprint-node__id">#${escapeHtml(node.id)}</span>
    </div>
    <div class="blueprint-node__body">
      <div class="blueprint-node__ports blueprint-node__ports--input">
        ${inputs.map((port) => renderBlueprintPort(node, port)).join('')}
      </div>
      <div class="blueprint-node__ports blueprint-node__ports--output">
        ${outputs.map((port) => renderBlueprintPort(node, port)).join('')}
      </div>
    </div>
  `;
}

function renderBlueprintPort(node, port) {
  const value = getBlueprintPortDisplayValue(node, port);
  const valueHtml = value ? `<span class="blueprint-port__value">${escapeHtml(value)}</span>` : '';
  return `
    <div class="blueprint-port-row blueprint-port-row--${escapeHtml(port.direction)} blueprint-port-row--${escapeHtml(port.kind)}">
      ${port.direction === 'input' ? renderBlueprintPortDot(port) : ''}
      <span class="blueprint-port__label">${escapeHtml(port.label || port.id)}</span>
      ${valueHtml}
      ${port.direction === 'output' ? renderBlueprintPortDot(port) : ''}
    </div>
  `;
}

function renderBlueprintPortDot(port) {
  return `<span class="blueprint-port blueprint-port--${escapeHtml(port.kind)}" data-port-id="${escapeHtml(port.id)}" data-port-direction="${escapeHtml(port.direction)}" title="${escapeHtml(`${port.label || port.id}: ${port.type}`)}"></span>`;
}

function getBlueprintPortDisplayValue(node, port) {
  if (port.kind !== 'data' || port.direction !== 'input') {
    return '';
  }
  const valuesPath = getBlueprintSpec().values;
  const value = getByPath(node.value, `${valuesPath}.${port.id}`);
  if (value !== undefined && value !== null && value !== '') {
    return formatValue(value);
  }
  if (port.default !== undefined && port.default !== '') {
    return formatValue(port.default);
  }
  return '';
}

function drawBlueprintEdges(layout) {
  graphEdges.innerHTML = '';
  graphEdges.append(createGraphArrowDefs());
  layout.edges.forEach((edge, index) => {
    const edgeKey = getGraphEdgeSelectionKey(edge, index);
    const selected = isGraphEdgeSelected(edgeKey, edge);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.classList.add('graph-edge', 'blueprint-edge');
    line.classList.add(edge.kind === 'control' ? 'blueprint-edge--control' : 'blueprint-edge--data');
    if (selected) {
      line.classList.add('graph-edge--highlight');
    }
    line.setAttribute('d', edge.path);
    line.setAttribute('marker-end', 'url(#graphArrow)');
    line.addEventListener('click', (event) => {
      event.stopPropagation();
      selectGraphEdge(edge, edgeKey);
    });
    graphEdges.append(line);

    const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hitPath.classList.add('graph-edge-hit');
    hitPath.setAttribute('d', edge.path);
    hitPath.addEventListener('click', (event) => {
      event.stopPropagation();
      selectGraphEdge(edge, edgeKey);
    });
    graphEdges.append(hitPath);
  });
}

function redrawBlueprintGraphEdgesDuringDrag() {
  if (!isBlueprintGraph()) {
    return;
  }
  const model = buildBlueprintModel();
  const layout = measureBlueprintLayout(model, layoutBlueprintGraph(model));
  graphView.dataset.layout = 'blueprint';
  applyGraphLayoutSurface(layout);
  drawBlueprintEdges(layout);
}

function drawGraphLayout(graph, layout) {
  graphNodes.innerHTML = '';
  graphView.dataset.layout = getGraphLayoutMode();
  applyGraphLayoutSurface(layout);
  drawGraphEdges(layout);

  for (const node of layout.nodes || graph.nodes) {
    const pos = layout.positions.get(node.key);
    const size = layout.sizes?.get(node.key);
    if (!pos) {
      continue;
    }

    const item = document.createElement(isVirtualGraphNode(node) ? 'div' : 'button');
    if (item instanceof HTMLButtonElement) {
      item.type = 'button';
    }
    item.className = getGraphNodeClassName(node, graph);
    if (state.selectedKey === node.key) {
      item.classList.add('is-selected');
    }
    if (isGraphNodeHighlighted(node.key)) {
      item.classList.add('is-highlighted');
    }
    item.dataset.collection = node.collection;
    item.dataset.key = node.key;
    item.style.left = `${pos.x}px`;
    item.style.top = `${pos.y}px`;
    if (size?.height) {
      item.style.height = `${size.height}px`;
    }
    item.innerHTML = renderGraphNodeContent(node, graph);
    item.addEventListener('click', () => {
      if (state.suppressClick) {
        return;
      }
      state.selectedKey = node.key;
      state.selectedEdge = null;
      resetJsonDraftState();
      renderInspector();
      renderGraph();
      updateActionButtons();
    });
    item.addEventListener('mousedown', (event) => {
      if (event.button !== 0 || !isFreeGraph() || isVirtualGraphNode(node)) {
        return;
      }
      startGraphDrag(event, node, item, pos);
    });
    graphNodes.append(item);
  }
}

function applyGraphLayoutSurface(layout) {
  state.view.contentWidth = layout.width;
  state.view.contentHeight = layout.height;
  graphStage.style.width = `${layout.width}px`;
  graphStage.style.height = `${layout.height}px`;
  graphNodes.style.width = `${layout.width}px`;
  graphNodes.style.height = `${layout.height}px`;
  graphEdges.setAttribute('width', String(layout.width));
  graphEdges.setAttribute('height', String(layout.height));
  graphEdges.setAttribute('viewBox', `0 0 ${layout.width} ${layout.height}`);
}

function drawGraphEdges(layout) {
  graphEdges.innerHTML = '';
  graphEdges.append(createGraphArrowDefs());

  layout.edges.forEach((edge, index) => {
    const edgeKey = getGraphEdgeSelectionKey(edge, index);
    const edgeSelected = isGraphEdgeSelected(edgeKey, edge);
    const line = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    line.classList.add('graph-edge');
    applyGraphEdgeClasses(line, edge);
    if (edgeSelected) {
      line.classList.add('graph-edge--highlight');
    }
    line.setAttribute('d', edge.path);
    line.setAttribute('marker-end', 'url(#graphArrow)');
    line.addEventListener('click', (event) => {
      event.stopPropagation();
      selectGraphEdge(edge, edgeKey);
    });
    graphEdges.append(line);

    const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hitPath.classList.add('graph-edge-hit');
    hitPath.setAttribute('d', edge.path);
    hitPath.addEventListener('click', (event) => {
      event.stopPropagation();
      selectGraphEdge(edge, edgeKey);
    });
    graphEdges.append(hitPath);

    if (edge.label) {
      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.classList.add('graph-edge__label');
      if (edgeSelected) {
        text.classList.add('graph-edge__label--highlight');
      }
      text.setAttribute('x', String(edge.labelX ?? ((edge.startX + edge.endX) / 2)));
      text.setAttribute('y', String(edge.labelY ?? ((edge.startY + edge.endY) / 2)));
      text.setAttribute('text-anchor', 'middle');
      text.textContent = edge.label;
      text.addEventListener('click', (event) => {
        event.stopPropagation();
        selectGraphEdge(edge, edgeKey);
      });
      graphEdges.append(text);
    }
  });
}

function getRenderedGraphNodeSizeOverrides() {
  const measuredSizes = new Map();
  graphNodes.querySelectorAll('.graph-node').forEach((item) => {
    const key = item.dataset.key;
    if (!key) {
      return;
    }

    const rect = item.getBoundingClientRect();
    const scaledRectHeight = state.view.scale ? rect.height / state.view.scale : rect.height;
    measuredSizes.set(key, {
      width: GRAPH_NODE_WIDTH,
      height: Math.max(item.offsetHeight || 0, scaledRectHeight || 0)
    });
  });
  return measuredSizes.size ? measuredSizes : null;
}

function redrawFreeGraphEdgesDuringDrag() {
  if (!state.data || state.domain?.kind !== 'graph' || !isFreeGraph()) {
    return;
  }

  const graph = buildGraphModel();
  const layout = layoutFreeGraph(graph, getRenderedGraphNodeSizeOverrides());
  graphView.dataset.layout = getGraphLayoutMode();
  applyGraphLayoutSurface(layout);
  drawGraphEdges(layout);
}

function selectGraphEdge(edge, edgeKey) {
  state.selectedKey = edgeKey;
  state.selectedEdge = edge;
  resetJsonDraftState();
  renderInspector({ edge });
  renderGraph();
  updateActionButtons();
}

function getGraphEdgeSelectionKey(edge, index) {
  return `${edge.from}->${edge.to}:${edge.field || edge.kind || 'edge'}:${index}`;
}

function isGraphEdgeSelected(edgeKey, edge) {
  if (state.selectedKey === edgeKey) {
    return true;
  }
  return !!state.selectedEdge
    && state.selectedEdge.from === edge.from
    && state.selectedEdge.to === edge.to
    && (state.selectedEdge.field || state.selectedEdge.kind || '') === (edge.field || edge.kind || '');
}

function isGraphNodeHighlighted(nodeKey) {
  if (!state.selectedEdge) {
    return false;
  }
  return state.selectedEdge.from === nodeKey || state.selectedEdge.to === nodeKey;
}

function measureRenderedGraphNodeSizes(layoutSizes) {
  let changed = false;
  const measuredSizes = new Map();
  graphNodes.querySelectorAll('.graph-node').forEach((item) => {
    const key = item.dataset.key;
    if (!key) {
      return;
    }

    const current = layoutSizes?.get(key) || { width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT };
    const style = window.getComputedStyle(item);
    const borderTop = parseFloat(style.borderTopWidth) || 0;
    const borderBottom = parseFloat(style.borderBottomWidth) || 0;
    const hasVerticalOverflow = item.scrollHeight > item.clientHeight + 1;
    const requiredHeight = hasVerticalOverflow
      ? Math.ceil(item.scrollHeight + borderTop + borderBottom + 2)
      : current.height;
    const height = Math.max(current.height || 0, requiredHeight);
    measuredSizes.set(key, { width: current.width || GRAPH_NODE_WIDTH, height });
    if (hasVerticalOverflow && height > (current.height || 0) + 1) {
      changed = true;
    }
  });

  if (!changed) {
    return null;
  }
  return measuredSizes;
}

function createGraphArrowDefs() {
  const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
  const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
  marker.setAttribute('id', 'graphArrow');
  marker.setAttribute('viewBox', '0 0 14 14');
  marker.setAttribute('refX', '12');
  marker.setAttribute('refY', '6');
  marker.setAttribute('markerWidth', '12');
  marker.setAttribute('markerHeight', '12');
  marker.setAttribute('orient', 'auto-start-reverse');
  marker.setAttribute('markerUnits', 'userSpaceOnUse');

  const arrow = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  arrow.setAttribute('d', 'M 2 2 L 11 7 L 2 12');
  arrow.setAttribute('fill', 'none');
  arrow.setAttribute('stroke', 'context-stroke');
  arrow.setAttribute('stroke-width', '2.2');
  arrow.setAttribute('stroke-linecap', 'round');
  arrow.setAttribute('stroke-linejoin', 'round');

  marker.append(arrow);
  defs.append(marker);
  return defs;
}

function applyGraphEdgeClasses(path, edge) {
  if (edge.field === 'fail' || edge.kind === 'fail' || edge.tone === 'fail' || edge.tone === 'danger') {
    path.classList.add('graph-edge--fail');
  }
  if (edge.tone === 'gate-pass') {
    path.classList.add('graph-edge--gate-pass');
  } else if (edge.tone === 'gate-fail') {
    path.classList.add('graph-edge--gate-fail');
  }

  const color = edge.color || edge.targetValue?.color || edge.sourceValue?.color || '';
  if (color === 'red') {
    path.classList.add('graph-edge--red');
  } else if (color === 'green') {
    path.classList.add('graph-edge--green');
  }
  if (edge.endY !== undefined && edge.startY !== undefined && edge.endY <= edge.startY) {
    path.classList.add('graph-edge--back');
  }
}

function buildGraphModel() {
  const config = state.domain.graph || {};
  const model = state.domain.model || {};
  const baseCollection = getBaseGraphCollection();
  const edgeRules = (config.edges || []).map(parseEdgeRule).filter(Boolean);
  const collectionNames = new Set([baseCollection]);
  edgeRules.forEach((rule) => {
    collectionNames.add(rule.sourceCollection);
    collectionNames.add(rule.targetCollection);
  });

  const nodes = [];
  const nodeMap = new Map();
  for (const collection of collectionNames) {
    const path = model[collection] || collection;
    const items = ensureArray(getByPath(state.data, path));
    const idKey = getGraphCollectionIdKey(collection);
    const kindKey = collection === baseCollection ? (config.nodeKind || 'kind') : '';
    items.forEach((value, index) => {
      const id = value?.[idKey] ?? index;
      const key = `${collection}:${id}`;
      const title = kindKey && value?.[kindKey] !== undefined ? getGraphKindLabel(value[kindKey]) : collection;
      const text = String(value?.title ?? value?.text ?? value?.name ?? '');
      const node = { key, collection, id, title, text, value };
      nodes.push(node);
      nodeMap.set(key, node);
    });
  }

  const edges = [];
  for (const rule of edgeRules) {
    const path = model[rule.sourceCollection] || rule.sourceCollection;
    const items = ensureArray(getByPath(state.data, path));
    const sourceIdKey = getGraphCollectionIdKey(rule.sourceCollection);
    for (const item of items) {
      const fromId = item?.[sourceIdKey];
      if (fromId === null || fromId === undefined || fromId === '') {
        continue;
      }
      const from = `${rule.sourceCollection}:${fromId}`;
      const targets = collectGraphEdgeTargets(item, rule.field);
      for (const target of targets) {
        const values = ensureArray(target.value, { scalar: true })
          .filter((value) => value !== null && value !== undefined && value !== '');
        for (const value of values) {
          const to = `${rule.targetCollection}:${value}`;
          const sourceNode = nodeMap.get(from) || null;
          const targetNode = nodeMap.get(to) || null;
          edges.push({
            from,
            to,
            sourceCollection: rule.sourceCollection,
            targetCollection: rule.targetCollection,
            field: rule.field,
            kind: getGraphEdgeKind(rule, sourceNode, targetNode),
            color: getGraphEdgeColor(rule, target.sourceValue, targetNode),
            tone: getGraphEdgeTone(rule, target.sourceValue),
            label: getGraphEdgeLabel(rule, target.sourceValue),
            rule: rule.raw,
            sourceValue: target.sourceValue,
            targetValue: targetNode?.value || null,
            sourceNode,
            targetNode
          });
        }
      }
    }
  }

  nodes.forEach((node) => {
    node.outgoing = edges.filter((edge) => edge.from === node.key);
    node.incoming = edges.filter((edge) => edge.to === node.key);
  });

  return {
    nodes,
    edges,
    nodeMap,
    baseCollection,
    entry: `${baseCollection}:${getByPath(state.data, config.entry || 'entry')}`,
    maxDepth: 1,
    maxRows: 1
  };
}

function parseEdgeRule(raw) {
  const source = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : null;
  const text = source
    ? `${source.from || source.field || source.path || ''} -> ${source.to || source.target || ''}`
    : String(raw || '');
  const parts = text.split('->').map((part) => part.trim());
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }

  const leftParts = parts[0].split('.');
  const rightParts = parts[1].split('.');
  const sourceCollection = leftParts.length > 1 ? leftParts[0] : (state.domain.graph?.nodes || 'nodes');
  const field = leftParts.length > 1 ? leftParts.slice(1).join('.') : leftParts[0];
  return {
    raw: text,
    sourceCollection,
    field,
    targetCollection: rightParts[0],
    targetField: rightParts[1] || 'id',
    label: source?.label || '',
    labelPath: source?.labelPath || source?.labelFrom || '',
    tone: source?.tone || '',
    color: source?.color || '',
    kind: source?.kind || ''
  };
}

function collectGraphEdgeTargets(root, pathText) {
  const parts = parsePathParts(pathText);
  if (!parts.length) {
    return [];
  }
  let current = [{ value: root, sourceValue: root }];
  parts.forEach((part, index) => {
    const isLast = index === parts.length - 1;
    const next = [];
    current.forEach((entry) => {
      const value = entry.value;
      if (Array.isArray(value)) {
        value.forEach((item) => {
          const child = getGraphEdgeChildValue(item, part);
          next.push({
            value: child,
            sourceValue: isLast ? item : child
          });
        });
        return;
      }
      const child = getGraphEdgeChildValue(value, part);
      next.push({
        value: child,
        sourceValue: isLast ? value : child
      });
    });
    current = next;
  });
  return current.filter((entry) => entry.value !== undefined);
}

function getGraphEdgeChildValue(value, key) {
  if (value === null || value === undefined) {
    return undefined;
  }
  return value?.[key];
}

function getBaseGraphCollection() {
  return state.domain?.graph?.nodes || 'nodes';
}

function getGraphCollectionIdKey(collection) {
  const config = state.domain.graph || {};
  return collection === getBaseGraphCollection()
    ? (config.nodeId || 'id')
    : (config[`${singular(collection)}Id`] || 'id');
}

function getGraphLabel(key, fallback) {
  return state.domain?.graph?.labels?.[key] ?? fallback;
}

function getGraphKindLabel(kind) {
  if (getGraphKindLabels()[kind] !== undefined) {
    return getGraphKindLabels()[kind];
  }
  if (kind !== null && kind !== undefined && kind !== '') {
    return String(kind);
  }
  return getGraphLabel('nodeKind', '节点');
}

function getGraphEdgeKind(rule, sourceNode, targetNode) {
  if (rule.kind) {
    return rule.kind;
  }
  if (rule.field === 'fail') {
    return 'fail';
  }
  if (rule.field === 'next') {
    return sourceNode?.collection === getBaseGraphCollection() ? 'next' : 'option-next';
  }
  if (targetNode?.collection && targetNode.collection !== getBaseGraphCollection()) {
    return 'option';
  }
  return rule.field;
}

function getGraphEdgeColor(rule, sourceValue, targetNode) {
  if (rule.color) {
    return rule.color;
  }
  if (targetNode?.value?.color) {
    return targetNode.value.color;
  }
  if (sourceValue?.color) {
    return sourceValue.color;
  }
  return '';
}

function getGraphEdgeTone(rule, sourceValue) {
  if (rule.tone) {
    return rule.tone;
  }
  if (Number(sourceValue?.kind) !== 2) {
    return '';
  }
  if (rule.field === 'next') {
    return 'gate-pass';
  }
  if (rule.field === 'fail') {
    return 'gate-fail';
  }
  return '';
}

function getGraphEdgeLabel(rule, sourceValue) {
  if (rule.label) {
    return String(rule.label);
  }
  if (rule.labelPath) {
    const value = getByPath(sourceValue, rule.labelPath);
    if (value !== undefined && value !== null && value !== '') {
      return String(value);
    }
  }
  if (rule.field === 'fail') {
    return getGraphLabel('failEdgeLabel', '失败');
  }
  if (Number(sourceValue?.kind) === 2 && rule.field === 'next') {
    return getGraphLabel('passEdgeLabel', '');
  }
  return '';
}

function getGraphNodeClassName(node, graph) {
  const classes = ['graph-node'];
  if (isVirtualGraphNode(node)) {
    classes.push('graph-node--pseudo');
    classes.push(node.virtual === 'start' ? 'graph-node--start' : 'graph-node--end');
    return classes.join(' ');
  }

  if (hasConfiguredGraphNodeView()) {
    return classes.join(' ');
  }

  if (!isBaseGraphNode(node, graph)) {
    classes.push('graph-node--option');
    if (node.value?.color === 'red') {
      classes.push('graph-node--option-red');
    } else if (node.value?.color === 'green') {
      classes.push('graph-node--option-green');
    }
  } else {
    const kind = Number(node.value?.kind);
    if (kind === 1) {
      classes.push('graph-node--ask');
    } else if (kind === 2) {
      classes.push('graph-node--gate');
    } else if (kind === 3) {
      classes.push('graph-node--set');
    } else if (kind === 4) {
      classes.push('graph-node--call');
    }
  }

  const actor = findGraphActor(node.value?.actorId);
  const sideClass = getGraphSideClass(actor, node.value?.actorId);
  if (sideClass) {
    classes.push(sideClass);
  }
  return classes.join(' ');
}

function renderGraphNodeContent(node, graph) {
  if (isVirtualGraphNode(node)) {
    const isStart = node.virtual === 'start';
    return `
      <div class="graph-node__pseudo-mark">${escapeHtml(isStart ? getGraphLabel('startKind', '开始') : getGraphLabel('endKind', '结束'))}</div>
      <div class="graph-node__pseudo-text">${escapeHtml(isStart ? getGraphLabel('startText', '流程从这里开始') : getGraphLabel('endText', '流程到这里结束'))}</div>
    `;
  }

  const view = buildGraphNodeView(node, graph);
  const detailHtml = view.detailLines.length
    ? `<div class="graph-node__detail-list">${view.detailLines.map((line) => `<div class="graph-node__detail">${escapeHtml(line)}</div>`).join('')}</div>`
    : '';
  return `
    <div class="graph-node__head">
      <span class="graph-node__kind${!isBaseGraphNode(node, graph) ? ' graph-node__kind--option' : ''}">${escapeHtml(view.kindLabel)}</span>
      <span class="graph-node__id">#${escapeHtml(node.id)}</span>
    </div>
    ${view.actorName || view.faceText ? `<div class="graph-node__actor">${escapeHtml(view.actorName)}${escapeHtml(view.faceText)}</div>` : ''}
    ${view.text ? `<div class="graph-node__text">${escapeHtml(view.text)}</div>` : ''}
    ${detailHtml}
  `;
}

function buildGraphNodeView(node, graph) {
  if (hasConfiguredGraphNodeView()) {
    return buildConfiguredGraphNodeView(node, graph);
  }

  if (!isBaseGraphNode(node, graph)) {
    const actor = findGraphActor(node.value?.actorId);
    const actorName = actor?.name || node.value?.actorId || getGraphLabel('narrator', '旁白');
    const faceText = node.value?.face ? ` (${node.value.face})` : '';
    return {
      kindLabel: getGraphLabel('optionKind', '选项'),
      actorName,
      faceText,
      text: String(node.value?.text || node.value?.title || getGraphLabel('emptyOption', '（空选项）')),
      detailLines: buildGraphOptionDetailLines(node, graph)
    };
  }

  const kind = Number(node.value?.kind);
  if (kind === 2) {
    return {
      kindLabel: getGraphKindLabel(node.value?.kind),
      actorName: getGraphLabel('gateActor', '条件'),
      faceText: '',
      text: summarizeGraphArray(node.value?.conds, getGraphLabel('noCondition', '（无条件，默认通过）')),
      detailLines: buildGraphTransitionDetailLines(node, graph)
    };
  }
  if (kind === 3) {
    return {
      kindLabel: getGraphKindLabel(node.value?.kind),
      actorName: getGraphLabel('setActor', '状态变更'),
      faceText: '',
      text: summarizeGraphArray(node.value?.acts, getGraphLabel('emptyActions', '（无动作）')),
      detailLines: buildGraphTransitionDetailLines(node, graph)
    };
  }
  if (kind === 4) {
    return {
      kindLabel: getGraphKindLabel(node.value?.kind),
      actorName: getGraphLabel('callActor', '外部调用'),
      faceText: '',
      text: String(node.value?.hook || node.value?.lua || node.value?.call || getGraphLabel('emptyCall', '（无调用）')),
      detailLines: buildGraphTransitionDetailLines(node, graph)
    };
  }

  const actor = findGraphActor(node.value?.actorId);
  const actorName = actor?.name || node.value?.actorId || getGraphLabel('narrator', '旁白');
  const faceText = node.value?.face ? ` (${node.value.face})` : '';
  const text = String(node.value?.text || node.value?.title || node.value?.name || getGraphLabel('emptyText', '（空文本）'));
  const detailLines = [];
  if (Array.isArray(node.value?.optionIds) && node.value.optionIds.length) {
    detailLines.push(`${getGraphLabel('branchCount', '分支数')}: ${node.value.optionIds.length}`);
  }
  detailLines.push(...buildGraphTransitionDetailLines(node, graph));
  return {
    kindLabel: getGraphKindLabel(node.value?.kind),
    actorName,
    faceText,
    text,
    detailLines
  };
}

function hasConfiguredGraphNodeView() {
  return !!state.domain?.graph?.nodeView && !isDialogGraphProfile();
}

function buildConfiguredGraphNodeView(node, graph) {
  const config = state.domain?.graph?.nodeView || {};
  const detailPaths = ensureArray(config.details, { scalar: true });
  const detailLines = detailPaths
    .map((pathText) => formatConfiguredGraphDetail(node, graph, pathText))
    .filter(Boolean);
  return {
    kindLabel: formatConfiguredGraphValue(node, graph, config.badge, getGraphLabel('nodeKind', '节点'), { kindLabel: true }),
    actorName: formatConfiguredGraphValue(node, graph, config.title, node.title || node.id),
    faceText: '',
    text: formatConfiguredGraphValue(node, graph, config.body, node.text || ''),
    detailLines
  };
}

function formatConfiguredGraphDetail(node, graph, pathText) {
  const text = String(pathText || '').trim();
  if (!text) {
    return '';
  }
  const value = getConfiguredGraphRawValue(node, graph, text);
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) {
    return '';
  }
  const label = formatGraphDetailLabel(text);
  const detailValue = formatGraphDetailValue(value);
  if (isGraphEdgeField(node, text)) {
    return `${label} -> #${detailValue}`;
  }
  return `${label}: ${detailValue}`;
}

function formatConfiguredGraphValue(node, graph, token, fallback, options = {}) {
  const text = String(token || '').trim();
  if (!text) {
    return String(fallback ?? '');
  }
  if (text.includes('{')) {
    const formatted = text.replace(/\{([^}]+)\}/g, (_, pathText) => {
      const value = getConfiguredGraphRawValue(node, graph, pathText.trim());
      return value === undefined || value === null ? '' : formatGraphInlineValue(value);
    }).trim();
    return formatted || String(fallback ?? '');
  }
  const value = getConfiguredGraphRawValue(node, graph, text);
  if (value === undefined || value === null || value === '') {
    return String(fallback ?? '');
  }
  if (options.kindLabel && text === (state.domain?.graph?.nodeKind || 'kind')) {
    return getGraphKindLabel(value);
  }
  return formatGraphInlineValue(value);
}

function getConfiguredGraphRawValue(node, graph, pathText) {
  if (pathText === 'id') {
    return node.id;
  }
  if (pathText === 'collection') {
    return node.collection;
  }
  if (pathText === 'title') {
    return getByPath(node.value, pathText) ?? node.title;
  }
  if (pathText === 'text') {
    return getByPath(node.value, pathText) ?? node.text;
  }
  const value = getByPath(node.value, pathText);
  if (value !== undefined) {
    return value;
  }
  const edge = node.outgoing?.find((item) => item.field === pathText || item.kind === pathText);
  return edge?.targetNode?.id ?? edge?.to?.split(':').pop();
}

function isGraphEdgeField(node, pathText) {
  return !!node.outgoing?.some((item) => item.field === pathText || item.kind === pathText);
}

function formatGraphDetailLabel(pathText) {
  const formLabel = getGraphNodeFormLabel(pathText);
  if (formLabel) {
    return formLabel;
  }

  const key = String(pathText || '').split('.').pop() || '';
  if (key === 'next') {
    return getGraphLabel('nextDetail', '后续');
  }
  if (key === 'fail') {
    return getGraphLabel('failDetail', '失败');
  }
  return key
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function getGraphNodeFormLabel(pathText) {
  const targetPath = String(pathText || '').trim();
  if (!targetPath) {
    return '';
  }

  const graphNodeForm = state.domain?.inspector?.forms?.graphNode;
  const fields = ensureArray(graphNodeForm?.groups).flatMap((group) => ensureArray(group?.fields));
  const directField = fields.find((field) => field?.path === targetPath);
  if (directField?.label) {
    return directField.label;
  }

  const rootPath = parsePathParts(targetPath)[0] || targetPath.split('.')[0];
  const rootField = fields.find((field) => field?.path === rootPath);
  return rootField?.label || '';
}

function buildGraphOptionDetailLines(node, graph) {
  const lines = [];
  const next = node.value?.next || node.outgoing?.find((edge) => edge.targetCollection === graph.baseCollection)?.targetNode?.id || '';
  lines.push(next
    ? `${getGraphLabel('nextDetail', '后续')} -> #${next}`
    : `${getGraphLabel('nextDetail', '后续')} -> ${getGraphLabel('endKind', '结束')}`);
  return lines;
}

function buildGraphTransitionDetailLines(node) {
  const lines = [];
  if (node.value?.next) {
    lines.push(`${getGraphLabel('nextDetail', '后续')} -> #${node.value.next}`);
  }
  if (node.value?.fail) {
    lines.push(`${getGraphLabel('failDetail', '失败')} -> #${node.value.fail}`);
  }
  if (Array.isArray(node.value?.conds) && node.value.conds.length) {
    lines.push(`${getGraphLabel('conditionCount', '条件数')}: ${node.value.conds.length}`);
  }
  if (Array.isArray(node.value?.acts) && node.value.acts.length) {
    lines.push(`${getGraphLabel('actionCount', '动作数')}: ${node.value.acts.length}`);
  }
  return lines;
}

function summarizeGraphArray(value, fallback) {
  if (!Array.isArray(value) || !value.length) {
    return fallback;
  }
  return value.map((item) => {
    if (item === null || item === undefined) {
      return '';
    }
    if (typeof item === 'string' || typeof item === 'number' || typeof item === 'boolean') {
      return String(item);
    }
    return summarizeGraphObjectItem(item);
  }).filter(Boolean).join('\n') || fallback;
}

function summarizeGraphObjectItem(item) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) {
    return formatGraphInlineValue(item);
  }

  const label = firstGraphSummaryValue(item, ['label', 'title', 'name', 'id']);
  const target = firstGraphSummaryValue(item, ['target', 'next', 'to']);
  if (target !== '') {
    return label ? `${label} -> ${formatGraphTargetValue(target)}` : formatGraphTargetValue(target);
  }

  if (item.name !== undefined && item.value !== undefined) {
    return `${formatGraphInlineValue(item.name)} = ${formatGraphInlineValue(item.value)}`;
  }

  if (item.key !== undefined && item.value !== undefined) {
    return `${formatGraphInlineValue(item.key)} = ${formatGraphInlineValue(item.value)}`;
  }

  if (label) {
    return label;
  }

  return Object.entries(item)
    .filter(([, entryValue]) => entryValue !== null && entryValue !== undefined && entryValue !== '')
    .map(([key, entryValue]) => `${key}: ${formatGraphInlineValue(entryValue)}`)
    .join(', ');
}

function firstGraphSummaryValue(item, keys) {
  for (const key of keys) {
    const value = item?.[key];
    if (value !== undefined && value !== null && value !== '') {
      return formatGraphInlineValue(value);
    }
  }
  return '';
}

function formatGraphTargetValue(value) {
  const text = formatGraphInlineValue(value);
  return /^#/.test(text) || !text ? text : `#${text}`;
}

function formatGraphDetailValue(value) {
  if (Array.isArray(value)) {
    return summarizeGraphArray(value, '');
  }
  return formatGraphInlineValue(value);
}

function formatGraphInlineValue(value) {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(formatGraphInlineValue).filter(Boolean).join(', ')}]`;
  }
  if (typeof value === 'object') {
    const parts = Object.entries(value)
      .filter(([, entryValue]) => entryValue !== null && entryValue !== undefined && entryValue !== '')
      .map(([key, entryValue]) => `${key}: ${formatGraphInlineValue(entryValue)}`);
    return `{${parts.join(', ')}}`;
  }
  return String(value);
}

function findGraphActor(actorId) {
  if (!actorId) {
    return null;
  }
  const actors = ensureArray(getByPath(state.data, state.domain?.graph?.actors || 'meta.actors'));
  return actors.find((actor) => (
    actor?.id === actorId
    || actor?.key === actorId
    || actor?.actorId === actorId
    || actor?.name === actorId
  )) || null;
}

function getGraphSideClass(actor, actorId = '') {
  if (!actor) {
    return actorId ? '' : 'graph-node--side-narrator';
  }
  if (Number(actor.side) === 0) {
    return 'graph-node--side-left';
  }
  if (Number(actor.side) === 2) {
    return 'graph-node--side-narrator';
  }
  return 'graph-node--side-right';
}

function getGraphNodeHeight(node, graph) {
  if (isVirtualGraphNode(node)) {
    return GRAPH_PSEUDO_NODE_HEIGHT;
  }
  const view = buildGraphNodeView(node, graph);
  const actorLines = Math.max(1, estimateGraphTextLines(`${view.actorName || ''}${view.faceText || ''}`));
  const textLines = Math.max(1, estimateGraphTextLines(view.text || ''));
  const detailHeight = estimateGraphDetailBlockHeight(view.detailLines);
  const baseHeight = isBaseGraphNode(node, graph) ? 92 : 94;
  const expected = baseHeight
    + actorLines * GRAPH_ACTOR_LINE_HEIGHT
    + textLines * GRAPH_TEXT_LINE_HEIGHT
    + detailHeight;
  return Math.max(isBaseGraphNode(node, graph) ? GRAPH_NODE_HEIGHT : GRAPH_OPTION_NODE_HEIGHT, expected);
}

function getGraphNodeSize(node, graph, sizeOverrides = null) {
  const estimatedHeight = getGraphNodeHeight(node, graph);
  const override = sizeOverrides?.get(node?.key);
  const measuredHeight = Number(override?.height) || 0;
  return {
    width: GRAPH_NODE_WIDTH,
    height: Math.max(estimatedHeight, measuredHeight)
  };
}

function estimateGraphDetailBlockHeight(lines) {
  if (!Array.isArray(lines) || !lines.length) {
    return 0;
  }
  return GRAPH_DETAIL_LIST_TOP_HEIGHT
    + lines.reduce((sum, line) => {
      const wrappedLines = Math.max(1, estimateGraphTextLines(line));
      return sum + GRAPH_DETAIL_ROW_EXTRA_HEIGHT + wrappedLines * GRAPH_DETAIL_LINE_HEIGHT;
    }, 0)
    + Math.max(0, (lines.length - 1) * GRAPH_DETAIL_GAP);
}

function estimateGraphTextLines(value) {
  const text = String(value || '');
  if (!text) {
    return 1;
  }
  return text.split(/\r?\n/).reduce((sum, line) => {
    return sum + Math.max(1, Math.ceil(line.length / GRAPH_TEXT_LINE_WIDTH));
  }, 0);
}

function isVirtualGraphNode(node) {
  return !!node?.virtual;
}

function isBaseGraphNode(node, graph) {
  return node?.collection === (graph?.baseCollection || getBaseGraphCollection());
}

function isExplicitEndGraphNode(node, graph) {
  if (!isBaseGraphNode(node, graph)) {
    return false;
  }
  const kind = node.value?.kind;
  return Number(kind) === 5 || String(kind || '').toLowerCase() === 'end';
}

function createEndNodeKey(key) {
  return `${END_NODE_PREFIX}${key}`;
}

function layoutGraph(graph, sizeOverrides = null) {
  return isFreeGraph()
    ? layoutFreeGraph(graph, sizeOverrides)
    : layoutFixedGraph(graph, sizeOverrides);
}

function layoutFixedGraph(graph, sizeOverrides = null) {
  const nodesCollection = graph.baseCollection || getBaseGraphCollection();
  const displayNodes = [...graph.nodes];
  const displayNodeMap = new Map(graph.nodeMap);
  const displayEdges = graph.edges.filter((edge) => graph.nodeMap.has(edge.from) && graph.nodeMap.has(edge.to));
  const depth = new Map();
  const column = new Map();
  const entryKey = graph.nodeMap.has(graph.entry) ? graph.entry : graph.nodes[0]?.key;
  const queue = entryKey ? [entryKey] : [];
  let nextFreeColumn = 1;

  function claimColumn(preferred) {
    if (preferred >= nextFreeColumn) {
      nextFreeColumn = preferred + 1;
    }
    return preferred;
  }

  if (entryKey) {
    depth.set(entryKey, 1);
    column.set(entryKey, 0);
  }

  for (let i = 0; i < queue.length; i += 1) {
    const key = queue[i];
    const currentDepth = depth.get(key) || 0;
    const currentColumn = column.get(key) || 0;
    const transitions = displayEdges.filter((edge) => edge.from === key);
    transitions.forEach((edge, index) => {
      if (!displayNodeMap.has(edge.to)) {
        return;
      }
      const targetColumn = index === 0 ? claimColumn(currentColumn) : nextFreeColumn++;
      const extraDepth = getFixedExtraDepth(edge, transitions.length, nodesCollection);
      if (!depth.has(edge.to)) {
        depth.set(edge.to, currentDepth + extraDepth);
        column.set(edge.to, targetColumn);
        queue.push(edge.to);
      }
    });
  }

  let fallbackDepth = Math.max(0, ...depth.values()) + 1;
  for (const node of graph.nodes) {
    if (!depth.has(node.key)) {
      depth.set(node.key, fallbackDepth);
      column.set(node.key, nextFreeColumn++);
      fallbackDepth += 1;
    }
  }

  if (entryKey) {
    const startNode = {
      key: START_NODE_KEY,
      id: getGraphLabel('startKind', '开始'),
      collection: '__virtual__',
      title: getGraphLabel('startKind', '开始'),
      text: getGraphLabel('startText', '流程从这里开始'),
      value: null,
      virtual: 'start'
    };
    displayNodes.push(startNode);
    displayNodeMap.set(startNode.key, startNode);
    depth.set(startNode.key, 0);
    column.set(startNode.key, 0);
    displayEdges.push({
      from: startNode.key,
      to: entryKey,
      sourceCollection: startNode.collection,
      targetCollection: nodesCollection,
      field: 'start',
      kind: 'start',
      color: '',
      label: '',
      sourceValue: null,
      targetValue: graph.nodeMap.get(entryKey)?.value || null,
      sourceNode: startNode,
      targetNode: graph.nodeMap.get(entryKey) || null
    });
  }

  const terminalNodes = graph.nodes.filter((node) => {
    if (isExplicitEndGraphNode(node, graph)) {
      return false;
    }
    return !displayEdges.some((edge) => edge.from === node.key);
  });
  terminalNodes.forEach((node) => {
    const endNode = {
      key: createEndNodeKey(node.key),
      id: getGraphLabel('endKind', '结束'),
      collection: '__virtual__',
      title: getGraphLabel('endKind', '结束'),
      text: getGraphLabel('endText', '流程到这里结束'),
      value: null,
      virtual: 'end',
      from: node.key
    };
    displayNodes.push(endNode);
    displayNodeMap.set(endNode.key, endNode);
    depth.set(endNode.key, (depth.get(node.key) || 0) + 1);
    column.set(endNode.key, column.get(node.key) || 0);
    displayEdges.push({
      from: node.key,
      to: endNode.key,
      sourceCollection: node.collection,
      targetCollection: endNode.collection,
      field: 'end',
      kind: 'end',
      color: '',
      label: '',
      sourceValue: node.value,
      targetValue: null,
      sourceNode: node,
      targetNode: endNode
    });
  });

  const rows = buildFixedRows(displayNodes, depth, column);
  const columnMap = new Map(rows.map((row) => [row.key, row.column]));
  const rowDepthMap = new Map(rows.map((row) => [row.key, row.depth]));
  const sizes = new Map(rows.map((row) => {
    const node = displayNodeMap.get(row.key);
    return [row.key, getGraphNodeSize(node, graph, sizeOverrides)];
  }));
  const positions = new Map(rows.map((row) => [row.key, { x: 0, y: 0 }]));
  const horizontalHints = buildFixedHorizontalRouteHints(displayEdges, columnMap, rowDepthMap);
  const depthHeights = new Map();
  const sortedDepths = [...new Set(rows.map((row) => row.depth))].sort((a, b) => a - b);

  rows.forEach((row) => {
    const current = depthHeights.get(row.depth) || 0;
    depthHeights.set(row.depth, Math.max(current, sizes.get(row.key)?.height || GRAPH_NODE_HEIGHT));
  });

  let currentY = FIXED_GRAPH_MARGIN;
  let previousDepth = sortedDepths.length > 0 ? sortedDepths[0] : 0;
  sortedDepths.forEach((currentDepth, index) => {
    if (index > 0) {
      const skippedDepths = Math.max(0, currentDepth - previousDepth - 1);
      currentY += skippedDepths * GRAPH_NODE_HEIGHT;
    }

    currentY += (horizontalHints.depthTopCounts.get(currentDepth) || 0) * FIXED_ROUTE_INTERVAL_GAP;

    rows
      .filter((row) => row.depth === currentDepth)
      .forEach((row) => {
        const point = positions.get(row.key);
        positions.set(row.key, { x: point.x, y: currentY });
      });

    currentY += (depthHeights.get(currentDepth) || GRAPH_NODE_HEIGHT)
      + ((horizontalHints.depthBottomCounts.get(currentDepth) || 0) * FIXED_ROUTE_INTERVAL_GAP)
      + FIXED_DEPTH_GAP;
    previousDepth = currentDepth;
  });

  const depthTop = new Map();
  const depthBottom = new Map();
  sortedDepths.forEach((currentDepth) => {
    const depthRows = rows.filter((row) => row.depth === currentDepth);
    if (!depthRows.length) {
      return;
    }

    const top = Math.min(...depthRows.map((row) => positions.get(row.key)?.y ?? 0));
    const bottom = Math.max(...depthRows.map((row) => {
      const point = positions.get(row.key);
      const size = sizes.get(row.key);
      return (point?.y ?? 0) + (size?.height || GRAPH_NODE_HEIGHT);
    }));
    depthTop.set(currentDepth, top);
    depthBottom.set(currentDepth, bottom);
  });

  const routePlan = planFixedEdgeRoutes(displayEdges, positions, sizes, columnMap, rowDepthMap, depthTop, depthBottom, horizontalHints);
  const columnX = buildFixedColumnXMap(rows, routePlan.leftCounts, routePlan.rightCounts);
  rows.forEach((row) => {
    const point = positions.get(row.key);
    positions.set(row.key, {
      x: columnX.get(row.column) ?? FIXED_GRAPH_SAFE_X,
      y: point.y
    });
  });

  const routedEdges = materializeFixedEdgeRoutes(routePlan.edges, positions, columnX);
  const finalNodeRight = rows.length
    ? Math.max(...rows.map((row) => (positions.get(row.key)?.x ?? 0) + GRAPH_NODE_WIDTH))
    : FIXED_GRAPH_SAFE_X + GRAPH_NODE_WIDTH;
  const finalRouteMaxX = routedEdges.length
    ? Math.max(...routedEdges.map((edge) => edge.maxX ?? finalNodeRight))
    : finalNodeRight;
  return {
    nodes: displayNodes,
    positions,
    sizes,
    edges: routedEdges,
    width: Math.max(1200, finalNodeRight, finalRouteMaxX) + FIXED_GRAPH_MARGIN,
    height: Math.max(720, currentY + FIXED_GRAPH_MARGIN)
  };
}

function getFixedExtraDepth(edge, transitionCount, nodesCollection) {
  if (edge.sourceCollection !== nodesCollection) {
    return 1;
  }
  if (edge.targetCollection !== nodesCollection || transitionCount > 1) {
    return 2;
  }
  return 1;
}

function buildFixedRows(nodes, depth, column) {
  const grouped = new Map();
  nodes.forEach((node) => {
    const currentDepth = depth.get(node.key) || 0;
    if (!grouped.has(currentDepth)) {
      grouped.set(currentDepth, []);
    }
    grouped.get(currentDepth).push(node.key);
  });

  const rows = [];
  [...grouped.keys()].sort((a, b) => a - b).forEach((currentDepth) => {
    const keys = grouped.get(currentDepth);
    keys.sort((a, b) => {
      const columnDelta = (column.get(a) ?? 0) - (column.get(b) ?? 0);
      return columnDelta !== 0 ? columnDelta : a.localeCompare(b, 'en', { numeric: true });
    });
    keys.forEach((key) => {
      rows.push({ key, depth: currentDepth, column: column.get(key) ?? 0 });
    });
  });
  return rows;
}

function buildFixedHorizontalRouteHints(edges, columnMap, rowDepthMap) {
  const exitCandidates = [];
  const enterCandidates = [];
  const exitLanes = new Map();
  const enterLanes = new Map();
  const depthTopCounts = new Map();
  const depthBottomCounts = new Map();

  edges.forEach((edge, index) => {
    const fromColumn = columnMap.get(edge.from) ?? 0;
    const toColumn = columnMap.get(edge.to) ?? 0;
    const fromDepth = rowDepthMap.get(edge.from) ?? 0;
    const toDepth = rowDepthMap.get(edge.to) ?? 0;
    const directDown = fromColumn === toColumn && toDepth > fromDepth && !isFixedFailEdge(edge);
    if (directDown) {
      return;
    }

    const anchor = getFixedEdgeLaneAnchor(fromColumn, toColumn, edge);
    const edgeKey = fixedEdgeKey(edge, index);

    exitCandidates.push({
      edgeKey,
      depth: fromDepth,
      start: Math.min(fromColumn, anchor.column),
      end: Math.max(fromColumn, anchor.column)
    });

    enterCandidates.push({
      edgeKey,
      depth: toDepth,
      start: Math.min(toColumn, anchor.column),
      end: Math.max(toColumn, anchor.column)
    });
  });

  assignFixedHorizontalLanes(exitCandidates, exitLanes, depthBottomCounts);
  assignFixedHorizontalLanes(enterCandidates, enterLanes, depthTopCounts);

  return {
    exitLanes,
    enterLanes,
    depthTopCounts,
    depthBottomCounts
  };
}

function assignFixedHorizontalLanes(candidates, laneMap, depthCountMap) {
  const groups = new Map();
  candidates
    .sort((a, b) => {
      if (a.depth !== b.depth) {
        return a.depth - b.depth;
      }
      if (a.start !== b.start) {
        return a.start - b.start;
      }
      return a.end - b.end;
    })
    .forEach((candidate) => {
      const groupKey = String(candidate.depth);
      if (!groups.has(groupKey)) {
        groups.set(groupKey, []);
      }

      const lanes = groups.get(groupKey);
      let laneIndex = lanes.findIndex((laneEnd) => candidate.start > laneEnd);
      if (laneIndex < 0) {
        laneIndex = lanes.length;
        lanes.push(candidate.end);
      } else {
        lanes[laneIndex] = candidate.end;
      }

      laneMap.set(candidate.edgeKey, laneIndex);
      depthCountMap.set(candidate.depth, Math.max(depthCountMap.get(candidate.depth) || 0, laneIndex + 1));
    });
}

function planFixedEdgeRoutes(edges, positions, sizes, columnMap, rowDepthMap, depthTop, depthBottom, horizontalHints) {
  const laneGroups = new Map();
  const plannedEdges = [];
  const routeCandidates = [];
  const leftCounts = new Map();
  const rightCounts = new Map();

  edges.forEach((edge, index) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    const fromSize = sizes.get(edge.from);
    const toSize = sizes.get(edge.to);
    const fromColumn = columnMap.get(edge.from) ?? 0;
    const toColumn = columnMap.get(edge.to) ?? 0;
    if (!from || !to) {
      return;
    }

    const startY = from.y + (fromSize?.height || GRAPH_NODE_HEIGHT);
    const endY = to.y;
    const fromDepth = rowDepthMap.get(edge.from) ?? 0;
    const toDepth = rowDepthMap.get(edge.to) ?? 0;
    const directDown = fromColumn === toColumn && endY > startY && !isFixedFailEdge(edge);
    if (directDown) {
      plannedEdges.push({
        ...edge,
        fromColumn,
        toColumn,
        startY,
        endY,
        directDown: true,
        labelY: (startY + endY) / 2
      });
      return;
    }

    const edgeKey = fixedEdgeKey(edge, index);
    const exitLane = horizontalHints.exitLanes.get(edgeKey) || 0;
    const enterLane = horizontalHints.enterLanes.get(edgeKey) || 0;
    const exitY = Math.max(startY + FIXED_EDGE_VERTICAL_GAP, (depthBottom.get(fromDepth) ?? startY) + FIXED_EDGE_VERTICAL_GAP)
      + exitLane * FIXED_ROUTE_INTERVAL_GAP;
    const enterY = Math.min(
      Math.max(to.y - FIXED_EDGE_VERTICAL_GAP, to.y - (toSize?.height || GRAPH_NODE_HEIGHT) * 0.2),
      (depthTop.get(toDepth) ?? to.y) - FIXED_EDGE_VERTICAL_GAP - enterLane * FIXED_ROUTE_INTERVAL_GAP
    );
    const intervalStart = Math.min(exitY, enterY);
    const intervalEnd = Math.max(exitY, enterY);
    const anchor = getFixedEdgeLaneAnchor(fromColumn, toColumn, edge);
    routeCandidates.push({
      edge,
      fromColumn,
      toColumn,
      startY,
      endY,
      exitY,
      enterY,
      intervalStart,
      intervalEnd,
      anchor,
      laneKey: `${anchor.side}:${anchor.column}`
    });
  });

  routeCandidates
    .sort((a, b) => {
      const keyDelta = a.laneKey.localeCompare(b.laneKey, 'en');
      if (keyDelta !== 0) {
        return keyDelta;
      }
      if (a.intervalStart !== b.intervalStart) {
        return a.intervalStart - b.intervalStart;
      }
      return a.intervalEnd - b.intervalEnd;
    })
    .forEach((candidate) => {
      if (!laneGroups.has(candidate.laneKey)) {
        laneGroups.set(candidate.laneKey, []);
      }

      const lanes = laneGroups.get(candidate.laneKey);
      let laneIndex = lanes.findIndex((laneEnd) => candidate.intervalStart > laneEnd + FIXED_ROUTE_INTERVAL_GAP);
      if (laneIndex < 0) {
        laneIndex = lanes.length;
        lanes.push(candidate.intervalEnd);
      } else {
        lanes[laneIndex] = candidate.intervalEnd;
      }

      if (candidate.anchor.side === 'left') {
        leftCounts.set(candidate.anchor.column, Math.max(leftCounts.get(candidate.anchor.column) || 0, laneIndex + 1));
      } else {
        rightCounts.set(candidate.anchor.column, Math.max(rightCounts.get(candidate.anchor.column) || 0, laneIndex + 1));
      }

      plannedEdges.push({
        ...candidate.edge,
        fromColumn: candidate.fromColumn,
        toColumn: candidate.toColumn,
        startY: candidate.startY,
        endY: candidate.endY,
        exitY: candidate.exitY,
        enterY: candidate.enterY,
        anchor: candidate.anchor,
        laneIndex,
        directDown: false,
        labelY: (candidate.exitY + candidate.enterY) / 2
      });
    });

  return { edges: plannedEdges, leftCounts, rightCounts };
}

function getFixedEdgeLaneAnchor(fromColumn, toColumn, edge) {
  if (toColumn > fromColumn) {
    return { side: 'right', column: toColumn };
  }

  if (toColumn < fromColumn) {
    return { side: 'left', column: toColumn };
  }

  if (isFixedFailEdge(edge)) {
    return { side: 'right', column: fromColumn };
  }

  return { side: 'left', column: fromColumn };
}

function buildFixedColumnXMap(rows, leftCounts, rightCounts) {
  const columns = [...new Set(rows.map((row) => row.column))].sort((a, b) => a - b);
  const xMap = new Map();
  if (!columns.length) {
    return xMap;
  }

  const first = columns[0];
  xMap.set(first, FIXED_GRAPH_SAFE_X + (leftCounts.get(first) || 0) * FIXED_ROUTE_GUTTER);
  for (let index = 1; index < columns.length; index += 1) {
    const previous = columns[index - 1];
    const current = columns[index];
    const baseGap = FIXED_COLUMN_STEP - GRAPH_NODE_WIDTH;
    const routeGap = ((rightCounts.get(previous) || 0) + (leftCounts.get(current) || 0) + 1) * FIXED_ROUTE_GUTTER;
    const gap = Math.max(baseGap, routeGap);
    xMap.set(current, (xMap.get(previous) || FIXED_GRAPH_SAFE_X) + GRAPH_NODE_WIDTH + gap);
  }

  return xMap;
}

function materializeFixedEdgeRoutes(plannedEdges, positions, columnX) {
  return plannedEdges.map((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    const startX = (from?.x || 0) + GRAPH_NODE_WIDTH / 2;
    const endX = (to?.x || 0) + GRAPH_NODE_WIDTH / 2;
    if (edge.directDown) {
      return {
        ...edge,
        startX,
        endX,
        labelX: (startX + endX) / 2,
        labelY: edge.labelY ?? ((edge.startY + edge.endY) / 2),
        minX: Math.min(startX, endX),
        maxX: Math.max(startX, endX),
        path: `M ${startX} ${edge.startY} L ${endX} ${edge.endY}`
      };
    }

    const routeX = getFixedLaneX(edge.anchor.side, edge.anchor.column, edge.laneIndex, columnX);
    return {
      ...edge,
      startX,
      endX,
      routeX,
      labelX: routeX,
      labelY: edge.labelY ?? ((edge.exitY + edge.enterY) / 2),
      minX: Math.min(startX, endX, routeX),
      maxX: Math.max(startX, endX, routeX),
      path: `M ${startX} ${edge.startY} L ${startX} ${edge.exitY} L ${routeX} ${edge.exitY} L ${routeX} ${edge.enterY} L ${endX} ${edge.enterY} L ${endX} ${edge.endY}`
    };
  });
}

function getFixedLaneX(side, anchorColumn, laneIndex, columnX) {
  const columnStartX = columnX.get(anchorColumn) ?? (FIXED_GRAPH_SAFE_X + anchorColumn * FIXED_COLUMN_STEP);
  const laneOffset = FIXED_ROUTE_GUTTER * (laneIndex + 1);
  return side === 'left'
    ? columnStartX - laneOffset
    : columnStartX + GRAPH_NODE_WIDTH + laneOffset;
}

function fixedEdgeKey(edge, index) {
  return `${edge.from}->${edge.to}:${edge.field}:${index}`;
}

function isFixedFailEdge(edge) {
  return edge.field === 'fail';
}

function layoutFreeGraph(graph, sizeOverrides = null) {
  let fallback = null;
  const grid = getGraphGridSize();
  const positions = new Map();
  const sizes = new Map(graph.nodes.map((node) => [node.key, getGraphNodeSize(node, graph, sizeOverrides)]));
  graph.nodes.forEach((node) => {
    const saved = getNodeGridPosition(node);
    if (saved) {
      positions.set(node.key, { x: saved.x * grid, y: saved.y * grid });
      return;
    }

    fallback ??= layoutFixedGraph(graph, sizeOverrides);
    const fallbackPosition = fallback.positions.get(node.key) || { x: FIXED_GRAPH_MARGIN, y: FIXED_GRAPH_MARGIN };
    positions.set(node.key, {
      x: Math.round(fallbackPosition.x / grid) * grid,
      y: Math.round(fallbackPosition.y / grid) * grid
    });
  });

  const routedEdges = graph.edges.map((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) {
      return null;
    }

    const fromSize = sizes.get(edge.from) || { width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT };
    const toSize = sizes.get(edge.to) || { width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT };
    const startX = from.x + fromSize.width;
    const startY = from.y + fromSize.height / 2;
    const endX = to.x;
    const endY = to.y + toSize.height / 2;
    const handle = Math.max(80, Math.abs(endX - startX) / 2);
    return {
      ...edge,
      startX,
      startY,
      endX,
      endY,
      labelX: (startX + endX) / 2,
      labelY: (startY + endY) / 2,
      minX: Math.min(startX, endX),
      maxX: Math.max(startX, endX),
      path: `M ${startX} ${startY} C ${startX + handle} ${startY}, ${endX - handle} ${endY}, ${endX} ${endY}`
    };
  }).filter(Boolean);

  const width = Math.max(1100, maxGraphExtent(positions, sizes, 'x') + FIXED_GRAPH_MARGIN);
  const height = Math.max(720, maxGraphExtent(positions, sizes, 'y') + FIXED_GRAPH_MARGIN);
  return { nodes: graph.nodes, positions, sizes, edges: routedEdges, width, height };
}

function maxGraphExtent(positions, sizes, key) {
  if (!positions.size) {
    return 0;
  }
  const sizeKey = key === 'x' ? 'width' : 'height';
  return Math.max(...[...positions.entries()].map(([nodeKey, position]) => {
    const size = sizes.get(nodeKey);
    return (position[key] || 0) + (size?.[sizeKey] || 0);
  }));
}

function getGraphLayoutMode() {
  const raw = String(state.domain?.graph?.layout || 'fixed').trim().toLowerCase();
  if (raw === 'free' || raw === 'movable' || raw === 'blueprint') {
    return 'free';
  }
  return 'fixed';
}

function isFreeGraph() {
  return getGraphLayoutMode() === 'free';
}

function getGraphGridSize() {
  const value = Number(state.domain?.graph?.grid || DEFAULT_GRAPH_GRID);
  return Number.isFinite(value) && value > 0 ? value : DEFAULT_GRAPH_GRID;
}

function getGraphPositionPath() {
  return state.domain?.graph?.position || 'pos';
}

function getGraphPositionConfig() {
  return state.domain?.graph?.position || 'pos';
}

function getNodeGridPosition(node) {
  const position = getGraphPositionConfig();
  if (position && typeof position === 'object' && !Array.isArray(position)) {
    const rawX = getByPath(node.value, position.x || 'x');
    const rawY = getByPath(node.value, position.y || 'y');
    if (!isIntegerValue(rawX) || !isIntegerValue(rawY)) {
      return null;
    }
    return {
      x: Number(rawX),
      y: Number(rawY)
    };
  }

  const value = getByPath(node.value, position);
  if (!value || typeof value !== 'object') {
    return null;
  }
  if (!isIntegerValue(value.x) || !isIntegerValue(value.y)) {
    return null;
  }

  return {
    x: Number(value.x),
    y: Number(value.y)
  };
}

function isIntegerValue(value) {
  if (value === null || value === undefined || value === '') {
    return false;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return false;
  }
  return Number.isInteger(Number(value));
}

function setNodeGridPosition(node, x, y) {
  const position = getGraphPositionConfig();
  if (position && typeof position === 'object' && !Array.isArray(position)) {
    setByPath(node.value, position.x || 'x', Math.trunc(x));
    setByPath(node.value, position.y || 'y', Math.trunc(y));
    return;
  }
  setByPath(node.value, position, {
    x: Math.trunc(x),
    y: Math.trunc(y)
  });
}

function startGraphDrag(event, node, element, position) {
  event.preventDefault();
  const grid = getGraphGridSize();
  state.selectedKey = node.key;
  state.selectedEdge = null;
  resetJsonDraftState();
  updateActionButtons();
  state.history.dragBaseline = createHistorySnapshot(`Move ${node.key}`);
  state.drag = {
    node,
    element,
    startClientX: event.clientX,
    startClientY: event.clientY,
    startX: position.x,
    startY: position.y,
    lastGridX: Math.trunc(position.x / grid),
    lastGridY: Math.trunc(position.y / grid),
    moved: false
  };
  element.classList.add('is-selected');
  element.classList.add('is-dragging');
  document.addEventListener('mousemove', moveGraphDrag);
  document.addEventListener('mouseup', endGraphDrag, { once: true });
}

function moveGraphDrag(event) {
  if (!state.drag) {
    return;
  }

  const dx = (event.clientX - state.drag.startClientX) / state.view.scale;
  const dy = (event.clientY - state.drag.startClientY) / state.view.scale;
  const grid = getGraphGridSize();
  const nextPxX = Math.max(0, Math.round((state.drag.startX + dx) / grid) * grid);
  const nextPxY = Math.max(0, Math.round((state.drag.startY + dy) / grid) * grid);
  const nextGridX = Math.trunc(nextPxX / grid);
  const nextGridY = Math.trunc(nextPxY / grid);
  if (state.drag.lastGridX === nextGridX && state.drag.lastGridY === nextGridY) {
    return;
  }

  state.drag.element.style.left = `${nextPxX}px`;
  state.drag.element.style.top = `${nextPxY}px`;
  if (!state.drag.moved && state.history.dragBaseline) {
    pushHistorySnapshot(state.history.dragBaseline);
  }
  setNodeGridPosition(state.drag.node, nextGridX, nextGridY);
  state.drag.lastGridX = nextGridX;
  state.drag.lastGridY = nextGridY;
  state.drag.moved = true;
  state.dirty = true;
  if (isBlueprintGraph()) {
    redrawBlueprintGraphEdgesDuringDrag();
  } else {
    redrawFreeGraphEdgesDuringDrag();
  }
  setStatus(formatAppLabel('dirty', '已修改 - {title}', { title: `${state.drag.node.key} @ ${nextGridX}, ${nextGridY}` }));
}

function endGraphDrag() {
  if (!state.drag) {
    return;
  }

  document.removeEventListener('mousemove', moveGraphDrag);
  state.drag.element.classList.remove('is-dragging');
  state.suppressClick = state.drag.moved;
  state.drag = null;
  state.history.dragBaseline = null;
  resetJsonDraftState();
  renderGraph();
  renderInspector();
  setTimeout(() => {
    state.suppressClick = false;
  }, 0);
}

function clampViewScale(scale) {
  return Math.min(MAX_VIEW_SCALE, Math.max(MIN_VIEW_SCALE, scale));
}

function getViewportMetrics() {
  return {
    width: graphViewport.clientWidth || 1200,
    height: graphViewport.clientHeight || 640
  };
}

function clampGraphView() {
  const viewport = getViewportMetrics();
  const scale = clampViewScale(state.view.scale);
  const scaledWidth = state.view.contentWidth * scale;
  const scaledHeight = state.view.contentHeight * scale;
  const extraX = viewport.width * 0.5;
  const extraY = viewport.height * 0.5;
  const minTx = viewport.width - scaledWidth - extraX;
  const maxTx = extraX;
  const minTy = viewport.height - scaledHeight - extraY;
  const maxTy = extraY;

  state.view.scale = scale;
  state.view.tx = Math.min(maxTx, Math.max(minTx, state.view.tx));
  state.view.ty = Math.min(maxTy, Math.max(minTy, state.view.ty));
}

function applyGraphView() {
  graphStage.style.transform = `translate(${state.view.tx}px, ${state.view.ty}px) scale(${state.view.scale})`;
  viewScaleText.textContent = `${Math.round(state.view.scale * 100)}%`;
}

function resetGraphView(render = true) {
  fitGraphViewToContent();
  state.view.resetPending = false;
  clampGraphView();
  applyGraphView();
  if (render && state.domain?.kind === 'graph' && state.data) {
    renderGraph();
  }
}

function fitGraphViewToContent() {
  const viewport = getViewportMetrics();
  const contentWidth = Math.max(1, state.view.contentWidth || 1);
  const contentHeight = Math.max(1, state.view.contentHeight || 1);
  const availableWidth = Math.max(1, viewport.width - FIT_VIEW_PADDING * 2);
  const availableHeight = Math.max(1, viewport.height - FIT_VIEW_PADDING * 2 - FIT_VIEW_HUD_RESERVE);
  const fitScale = Math.min(MAX_VIEW_SCALE, availableWidth / contentWidth, availableHeight / contentHeight);
  const resetMinScale = Number(state.domain?.graph?.view?.resetMinScale ?? RESET_READABLE_MIN_SCALE);
  const scale = clampViewScale(Math.max(fitScale, Math.min(MAX_VIEW_SCALE, resetMinScale)));
  state.view.scale = scale;
  state.view.tx = Math.round((viewport.width - contentWidth * scale) / 2);
  state.view.ty = FIT_VIEW_PADDING;
}

function zoomGraphView(nextScale, pointerX, pointerY) {
  const currentScale = state.view.scale;
  const clampedScale = clampViewScale(nextScale);
  if (Math.abs(clampedScale - currentScale) < 0.0001) {
    return;
  }

  const worldX = (pointerX - state.view.tx) / currentScale;
  const worldY = (pointerY - state.view.ty) / currentScale;
  state.view.scale = clampedScale;
  state.view.tx = pointerX - worldX * clampedScale;
  state.view.ty = pointerY - worldY * clampedScale;
  state.view.resetPending = false;
  clampGraphView();
  applyGraphView();
}
