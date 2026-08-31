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

function getGraphProfileId() {
  return String(state.domain?.graph?.profile || state.domain?.graph?.adapter || '').trim().toLowerCase();
}

function isStateMachineProfile() {
  return getGraphProfileId() === 'state-machine';
}

function getGraphKindLabels() {
  return state.domain?.graph?.kindLabels || getGraphProfileConfig().kindLabels || {};
}

function showGraphContextMenu(x, y, nodeKey) {
  if (!nodeKey) {
    return;
  }
  if (isBlueprintGraph()) {
    showBlueprintGraphContextMenu(x, y, nodeKey);
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
  const rendered = isDialogGraphProfile()
    ? renderDialogGraphContextMenu(node, graph)
    : isStateMachineProfile()
      ? renderStateMachineGraphContextMenu(node, graph)
      : renderGenericGraphContextMenu(node, graph);
  if (!rendered) {
    hideGraphContextMenu();
    return;
  }
  renderInspector();
  renderGraph();
  openGraphContextMenu(x, y);
  updateActionButtons();
}

function openGraphContextMenu(x, y) {
  graphContextMenu.classList.remove('hidden');
  graphContextMenu.style.left = `${x + 6}px`;
  graphContextMenu.style.top = `${y + 6}px`;
  const rect = graphContextMenu.getBoundingClientRect();
  graphContextMenu.style.left = `${Math.max(8, Math.min(x + 6, window.innerWidth - rect.width - 8))}px`;
  graphContextMenu.style.top = `${Math.max(8, Math.min(y + 6, window.innerHeight - rect.height - 8))}px`;
}

function hideGraphContextMenu() {
  graphContextMenu.classList.add('hidden');
  state.contextGraphNodeKey = '';
  state.contextGraphEdgePath = '';
}

function appendGraphContextMenuGroup(title, actions) {
  if (!actions.length) {
    return;
  }
  const group = document.createElement('div');
  group.className = 'context-menu__group';
  const heading = document.createElement('div');
  heading.className = 'context-menu__title';
  heading.textContent = title;
  group.append(heading);
  actions.forEach((action) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = action.action;
    Object.entries(action.data || {}).forEach(([key, value]) => {
      button.dataset[key] = String(value);
    });
    button.textContent = action.label;
    if (action.danger) {
      button.className = 'danger';
    }
    group.append(button);
  });
  graphContextMenu.append(group);
}

function renderStateMachineGraphContextMenu(node, graph) {
  graphContextMenu.innerHTML = '';
  appendGraphContextMenuGroup('状态', [
    { action: 'state-edit', label: '编辑状态' },
    ...(graph.entry === node.key ? [] : [{ action: 'state-set-initial', label: '设为初始状态' }])
  ]);
  appendGraphContextMenuGroup('新增转换', graph.nodes
    .filter((candidate) => !isVirtualGraphNode(candidate))
    .map((candidate) => ({
      action: 'state-add-transition',
      label: `转到 ${getStateMachineNodeLabel(candidate)}`,
      data: { target: candidate.id }
    })));
  appendGraphContextMenuGroup('管理', [
    { action: 'state-delete', label: '删除状态', danger: true }
  ]);
  return true;
}

function getStateMachineNodeLabel(node) {
  return String(node?.value?.label || node?.value?.name || node?.id || '状态');
}

function showStateMachineEdgeContextMenu(x, y, edge, edgeKey) {
  if (!isStateMachineProfile() || !edge?.dataPath) {
    return;
  }
  selectGraphEdge(edge, edgeKey);
  state.contextGraphEdgePath = edge.dataPath;
  graphContextMenu.innerHTML = '';
  appendGraphContextMenuGroup('状态转换', [
    { action: 'state-edge-edit', label: '编辑转换' },
    { action: 'state-edge-delete', label: '删除转换', danger: true }
  ]);
  openGraphContextMenu(x, y);
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
  return true;
}

function renderGenericGraphContextMenu(node, graph) {
  const actions = getGenericGraphMutationActions(node, graph);
  if (!actions.length) {
    return false;
  }

  graphContextMenu.innerHTML = '';
  actions.forEach((action) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.action = action.id;
    button.textContent = action.label || getGenericGraphMutationLabel(action);
    if (action.type === 'delete' || action.danger) {
      button.className = 'danger';
    }
    graphContextMenu.append(button);
  });
  return true;
}

function showBlueprintGraphContextMenu(x, y, nodeKey) {
  const graph = buildBlueprintModel();
  const node = graph.nodeMap.get(nodeKey);
  if (!node) {
    return;
  }

  state.contextGraphNodeKey = nodeKey;
  state.selectedKey = nodeKey;
  state.selectedEdge = null;
  resetJsonDraftState();
  renderBlueprintGraphContextMenu(node, graph);
  renderInspector();
  renderGraph();
  openGraphContextMenu(x, y);
  updateActionButtons();
}

function showBlueprintCanvasContextMenu(x, y) {
  const graph = buildBlueprintModel();
  if (graph.nodes.length) {
    return false;
  }
  const roots = [...graph.typeMap.values()].filter((type) => type.category === 'root');
  const types = roots.length ? roots : [...graph.typeMap.values()];
  if (!types.length) {
    return false;
  }

  state.contextGraphNodeKey = '';
  graphContextMenu.innerHTML = '';
  appendBlueprintMenuGroup(roots.length ? '创建根节点' : '创建节点', types.map((type) => ({
    action: 'blueprint-add-root',
    label: type.title || type.id,
    nodeType: type.id
  })));
  openGraphContextMenu(x, y);
  return true;
}

function renderBlueprintGraphContextMenu(node, graph) {
  graphContextMenu.innerHTML = '';
  appendBlueprintMenuButton({ action: 'blueprint-edit', label: '编辑节点' });

  const choices = getBlueprintChildChoices(node, graph);
  const categoryLabels = {
    root: '根节点',
    composite: '添加结构节点',
    decorator: '添加装饰节点',
    condition: '添加条件节点',
    action: '添加动作节点'
  };
  const categoryOrder = ['composite', 'decorator', 'condition', 'action', 'root', ''];
  categoryOrder.forEach((category) => {
    const actions = choices
      .filter((choice) => (choice.type.category || '') === category)
      .map((choice) => ({
        action: 'blueprint-add-child',
        label: choice.type.title || choice.type.id,
        nodeType: choice.type.id,
        fromPort: choice.output.id,
        toPort: choice.input.id
      }));
    appendBlueprintMenuGroup(categoryLabels[category] || '添加子节点', actions);
  });

  if (canMoveBlueprintBranch(node, graph, -1)) {
    appendBlueprintMenuButton({ action: 'blueprint-move', label: '优先级上移', direction: '-1' });
  }
  if (canMoveBlueprintBranch(node, graph, 1)) {
    appendBlueprintMenuButton({ action: 'blueprint-move', label: '优先级下移', direction: '1' });
  }
  if (canDuplicateBlueprintBranch(node, graph)) {
    appendBlueprintMenuButton({
      action: 'blueprint-duplicate',
      label: getGraphAlgorithm() === 'tree' ? '复制当前分支' : '复制节点'
    });
  }
  appendBlueprintMenuButton({
    action: 'blueprint-delete',
    label: node.typeSpec?.category === 'root'
      ? '清空整棵树'
      : (getGraphAlgorithm() === 'tree' ? '删除当前分支' : '删除节点'),
    danger: true
  });
}

function appendBlueprintMenuGroup(title, actions) {
  if (!actions.length) {
    return;
  }
  const group = document.createElement('div');
  group.className = 'context-menu__group';
  const heading = document.createElement('div');
  heading.className = 'context-menu__title';
  heading.textContent = title;
  group.append(heading);
  actions.forEach((action) => appendBlueprintMenuButton(action, group));
  graphContextMenu.append(group);
}

function appendBlueprintMenuButton(action, host = graphContextMenu) {
  const button = document.createElement('button');
  button.type = 'button';
  button.dataset.action = action.action;
  for (const key of ['nodeType', 'fromPort', 'toPort', 'direction']) {
    if (action[key] !== undefined) {
      button.dataset[key] = String(action[key]);
    }
  }
  button.textContent = action.label;
  if (action.danger) {
    button.className = 'danger';
  }
  host.append(button);
}

function getBlueprintChildChoices(node, graph) {
  const tree = getGraphAlgorithm() === 'tree';
  const outputs = (node.typeSpec?.outputs || []).filter((port) => {
    if (tree && port.kind !== 'control') {
      return false;
    }
    const used = node.outgoing?.filter((edge) => edge.fromPort === port.id).length || 0;
    return port.multiple || used === 0;
  });
  const choices = [];
  for (const type of graph.typeMap.values()) {
    if (tree && type.category === 'root') {
      continue;
    }
    for (const output of outputs) {
      const input = (type.inputs || []).find((candidate) => (
        (!tree || candidate.kind === 'control') && blueprintPortsCompatible(output, candidate)
      ));
      if (input) {
        choices.push({ type, output, input });
        break;
      }
    }
  }
  const rank = { composite: 0, decorator: 1, condition: 2, action: 3, root: 4 };
  return choices.sort((left, right) => (
    (rank[left.type.category] ?? 5) - (rank[right.type.category] ?? 5)
    || String(left.type.title || left.type.id).localeCompare(String(right.type.title || right.type.id), 'zh-CN')
  ));
}

function blueprintPortsCompatible(output, input) {
  return output.kind === input.kind
    && (output.type === input.type || output.type === 'any' || input.type === 'any');
}

function runGraphContextAction(action, options = {}) {
  if (isBlueprintGraph()) {
    runBlueprintGraphContextAction(action, options);
    return;
  }
  if (isStateMachineProfile()) {
    runStateMachineContextAction(action, options);
    return;
  }
  const kind = typeof options === 'object' ? Number(options.kind) : Number(options);
  if (!isDialogGraphProfile()) {
    runGenericGraphContextAction(action);
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

function runStateMachineContextAction(action, options = {}) {
  if (action === 'state-edge-edit') {
    hideGraphContextMenu();
    requestAnimationFrame(() => inspectorForm.querySelector('select, textarea, input')?.focus());
    return;
  }
  if (action === 'state-edge-delete') {
    hideGraphContextMenu();
    deleteSelection();
    return;
  }

  const graph = buildGraphModel();
  const node = graph.nodeMap.get(state.contextGraphNodeKey || state.selectedKey);
  if (!node || isVirtualGraphNode(node)) {
    hideGraphContextMenu();
    return;
  }
  if (action === 'state-edit') {
    hideGraphContextMenu();
    requestAnimationFrame(() => inspectorForm.querySelector('select, textarea, input')?.focus());
    return;
  }
  if (action === 'state-set-initial') {
    setStateMachineInitialNode(node);
  } else if (action === 'state-add-transition') {
    addStateMachineTransition(node, options.target, graph);
  } else if (action === 'state-delete') {
    deleteGraphSelectionItem();
  }
  hideGraphContextMenu();
}

function setStateMachineInitialNode(node) {
  const entryPath = state.domain.graph?.entry || 'initial';
  if (String(getByPath(state.data, entryPath)) === String(node.id)) {
    return;
  }
  pushHistory(`设置初始状态 ${getStateMachineNodeLabel(node)}`);
  setByPath(state.data, entryPath, node.id);
  state.selectedKey = node.key;
  state.selectedEdge = null;
  markDirtyAndRender(`初始状态：${getStateMachineNodeLabel(node)}`);
}

function addStateMachineTransition(node, targetId, graph) {
  const target = graph.nodes.find((candidate) => String(candidate.id) === String(targetId));
  if (!target) {
    return false;
  }
  const transitions = ensureArray(node.value?.transitions);
  const transition = {
    target: target.id,
    label: `转到${getStateMachineNodeLabel(target)}`,
    trigger: 'tick',
    priority: 0
  };
  pushHistory(`新增转换 ${getStateMachineNodeLabel(node)} -> ${getStateMachineNodeLabel(target)}`);
  transitions.push(transition);
  node.value.transitions = transitions;
  const nodePath = getGraphNodeDataPath(node);
  const dataPath = `${nodePath}.transitions[${transitions.length - 1}]`;
  const nextGraph = buildGraphModel();
  const edge = nextGraph.edges.find((candidate) => candidate.dataPath === dataPath) || null;
  state.selectedEdge = edge;
  state.selectedKey = edge ? getGraphEdgeSelectionKey(edge, nextGraph.edges.indexOf(edge)) : node.key;
  markDirtyAndRender(`已新增转换到 ${getStateMachineNodeLabel(target)}`);
  return true;
}

function runBlueprintGraphContextAction(action, options = {}) {
  if (action === 'blueprint-add-root') {
    addBlueprintRoot(options.nodeType);
    hideGraphContextMenu();
    return;
  }

  const graph = buildBlueprintModel();
  const node = graph.nodeMap.get(state.contextGraphNodeKey || state.selectedKey);
  if (!node) {
    hideGraphContextMenu();
    return;
  }

  if (action === 'blueprint-edit') {
    hideGraphContextMenu();
    requestAnimationFrame(() => inspectorForm.querySelector('select, textarea, input')?.focus());
    return;
  }
  if (action === 'blueprint-add-child') {
    addBlueprintChild(node, options, graph);
  } else if (action === 'blueprint-move') {
    moveBlueprintBranch(node, Number(options.direction), graph);
  } else if (action === 'blueprint-duplicate') {
    duplicateBlueprintBranch(node, graph);
  } else if (action === 'blueprint-delete') {
    deleteBlueprintBranch(node, graph);
  }
  hideGraphContextMenu();
}

function addBlueprintRoot(typeId) {
  const graph = buildBlueprintModel();
  if (graph.nodes.length) {
    return false;
  }
  const type = graph.typeMap.get(String(typeId || ''));
  if (!type) {
    return false;
  }

  const rows = ensureArray(getByPath(state.data, graph.spec.nodes));
  const id = getNextBlueprintNodeId(rows, graph.spec);
  const item = createBlueprintNodeValue(graph.spec, type, id, 0);
  if (getGraphAlgorithm() !== 'tree') {
    setByPath(item, graph.spec.position, { x: 8, y: 8 });
  }
  pushHistory(`创建 ${type.title || type.id}`);
  rows.push(item);
  setByPath(state.data, graph.spec.nodes, rows);
  state.selectedKey = `${graph.spec.nodes}:${id}`;
  state.selectedEdge = null;
  markDirtyAndRender(`已创建 ${type.title || type.id}`);
  return true;
}

function addBlueprintChild(node, options, graph = buildBlueprintModel()) {
  const choice = getBlueprintChildChoices(node, graph).find((candidate) => (
    candidate.type.id === options.nodeType
      && candidate.output.id === options.fromPort
      && candidate.input.id === options.toPort
  ));
  if (!choice) {
    return false;
  }

  const nodeRows = ensureArray(getByPath(state.data, graph.spec.nodes));
  const edgeRows = ensureArray(getByPath(state.data, graph.spec.edges));
  const id = getNextBlueprintNodeId(nodeRows, graph.spec);
  const order = getNextBlueprintChildOrder(node, graph);
  const item = createBlueprintNodeValue(graph.spec, choice.type, id, order);
  if (getGraphAlgorithm() !== 'tree') {
    const parentPos = getByPath(node.value, graph.spec.position) || { x: 0, y: 0 };
    setByPath(item, graph.spec.position, {
      x: Number(parentPos.x || 0) + 5,
      y: Number(parentPos.y || 0) + 8 + (node.outgoing?.length || 0) * 2
    });
  }
  const edge = createBlueprintEdgeValue(
    getNextBlueprintEdgeId(edgeRows),
    node.id,
    choice.output.id,
    id,
    choice.input.id
  );

  pushHistory(`添加 ${choice.type.title || choice.type.id}`);
  nodeRows.push(item);
  edgeRows.push(edge);
  setByPath(state.data, graph.spec.nodes, nodeRows);
  setByPath(state.data, graph.spec.edges, edgeRows);
  state.selectedKey = `${graph.spec.nodes}:${id}`;
  state.selectedEdge = null;
  markDirtyAndRender(`已添加 ${choice.type.title || choice.type.id}`);
  return true;
}

function createBlueprintNodeValue(spec, type, id, order) {
  const item = {};
  setByPath(item, spec.nodeId, id);
  setByPath(item, spec.nodeType, type.id);
  if (spec.note) {
    setByPath(item, spec.note, '');
  }
  const values = {};
  (type.inputs || []).filter((port) => port.kind === 'data').forEach((port) => {
    if (port.default !== undefined) {
      values[port.id] = clone(port.default);
    }
  });
  if ((type.inputs || []).some((port) => port.id === 'name') && state.data?.id) {
    values.name = state.data.id;
  }
  if ((type.inputs || []).some((port) => port.id === 'order')) {
    values.order = Number.isFinite(order) ? order : 0;
  }
  setByPath(item, spec.values, values);
  return item;
}

function createBlueprintEdgeValue(id, fromNode, fromPort, toNode, toPort) {
  return {
    id,
    from: { node: fromNode, port: fromPort },
    to: { node: toNode, port: toPort }
  };
}

function getNextBlueprintNodeId(rows, spec) {
  return rows.reduce((highest, item) => {
    const value = Number(getByPath(item, spec.nodeId));
    return Number.isInteger(value) ? Math.max(highest, value) : highest;
  }, 0) + 1;
}

function getNextBlueprintEdgeId(rows, reserved = new Set()) {
  const used = new Set(rows.map((item) => String(item?.id || '')));
  let index = 1;
  while (used.has(`e_${index}`) || reserved.has(`e_${index}`)) {
    index += 1;
  }
  const id = `e_${index}`;
  reserved.add(id);
  return id;
}

function getNextBlueprintChildOrder(node, graph) {
  const valuesPath = graph.spec.values || 'values';
  return (node.outgoing || [])
    .filter((edge) => edge.kind === 'control')
    .map((edge) => Number(getByPath(graph.nodeMap.get(edge.to)?.value, `${valuesPath}.order`)))
    .filter(Number.isFinite)
    .reduce((highest, value) => Math.max(highest, value), -1) + 1;
}

function getBlueprintParentEdge(node) {
  return (node.incoming || []).find((edge) => edge.kind === 'control') || null;
}

function getBlueprintSiblings(node, graph) {
  const parentEdge = getBlueprintParentEdge(node);
  if (!parentEdge) {
    return [];
  }
  const parent = graph.nodeMap.get(parentEdge.from);
  const siblings = (parent?.outgoing || [])
    .filter((edge) => edge.kind === 'control' && edge.fromPort === parentEdge.fromPort)
    .map((edge) => graph.nodeMap.get(edge.to))
    .filter(Boolean);
  const valuesPath = graph.spec.values || 'values';
  return siblings.sort((left, right) => (
    Number(getByPath(left.value, `${valuesPath}.order`) ?? left.id ?? 0)
      - Number(getByPath(right.value, `${valuesPath}.order`) ?? right.id ?? 0)
    || Number(left.id || 0) - Number(right.id || 0)
  ));
}

function canMoveBlueprintBranch(node, graph, direction) {
  if (getGraphAlgorithm() !== 'tree') {
    return false;
  }
  const siblings = getBlueprintSiblings(node, graph);
  const index = siblings.findIndex((candidate) => candidate.key === node.key);
  return index >= 0 && index + direction >= 0 && index + direction < siblings.length;
}

function moveBlueprintBranch(node, direction, graph = buildBlueprintModel()) {
  if (!canMoveBlueprintBranch(node, graph, direction)) {
    return false;
  }
  const siblings = getBlueprintSiblings(node, graph);
  const index = siblings.findIndex((candidate) => candidate.key === node.key);
  const target = index + direction;
  pushHistory(direction < 0 ? '上移行为树分支' : '下移行为树分支');
  siblings.forEach((candidate, order) => setBlueprintNodeOrder(candidate, graph.spec, order));
  setBlueprintNodeOrder(siblings[index], graph.spec, target);
  setBlueprintNodeOrder(siblings[target], graph.spec, index);
  state.selectedKey = node.key;
  state.selectedEdge = null;
  markDirtyAndRender(direction < 0 ? '分支优先级已上移' : '分支优先级已下移');
  return true;
}

function setBlueprintNodeOrder(node, spec, order) {
  setByPath(node.value, `${spec.values || 'values'}.order`, order);
}

function canDuplicateBlueprintBranch(node, graph) {
  if (getGraphAlgorithm() !== 'tree') {
    return true;
  }
  const parentEdge = getBlueprintParentEdge(node);
  const parent = parentEdge ? graph.nodeMap.get(parentEdge.from) : null;
  const output = parent ? getBlueprintPort(parent, parentEdge.fromPort, 'output') : null;
  return !!parentEdge && !!output?.multiple;
}

function duplicateBlueprintBranch(node, graph = buildBlueprintModel()) {
  if (!canDuplicateBlueprintBranch(node, graph)) {
    return false;
  }
  const tree = getGraphAlgorithm() === 'tree';
  const copies = tree ? getBlueprintSubtreeNodes(node, graph) : [node];
  const copyIds = new Set(copies.map((candidate) => String(candidate.id)));
  const nodeRows = ensureArray(getByPath(state.data, graph.spec.nodes));
  const edgeRows = ensureArray(getByPath(state.data, graph.spec.edges));
  const idMap = new Map();
  let nextId = getNextBlueprintNodeId(nodeRows, graph.spec);
  copies.forEach((candidate) => {
    idMap.set(String(candidate.id), nextId);
    nextId += 1;
  });

  const parentEdge = tree ? getBlueprintParentEdge(node) : null;
  const siblings = tree ? getBlueprintSiblings(node, graph) : [];
  const siblingIndex = siblings.findIndex((candidate) => candidate.key === node.key);
  pushHistory(tree ? '复制行为树分支' : '复制蓝图节点');
  if (tree) {
    siblings.forEach((candidate, order) => setBlueprintNodeOrder(candidate, graph.spec, order));
    siblings.slice(siblingIndex + 1).forEach((candidate, offset) => (
      setBlueprintNodeOrder(candidate, graph.spec, siblingIndex + 2 + offset)
    ));
  }

  const copiedRows = copies.map((candidate) => {
    const item = clone(candidate.value);
    setByPath(item, graph.spec.nodeId, idMap.get(String(candidate.id)));
    if (!tree) {
      const pos = getByPath(item, graph.spec.position) || { x: 0, y: 0 };
      setByPath(item, graph.spec.position, {
        x: Number(pos.x || 0) + 4,
        y: Number(pos.y || 0) + 4
      });
    }
    return item;
  });
  if (tree) {
    const copiedRoot = copiedRows.find((item) => (
      String(getByPath(item, graph.spec.nodeId)) === String(idMap.get(String(node.id)))
    ));
    setByPath(copiedRoot, `${graph.spec.values || 'values'}.order`, siblingIndex + 1);
  }

  const reservedEdgeIds = new Set();
  const copiedEdges = graph.edges
    .filter((edge) => copyIds.has(String(edge.sourceNode?.id)) && copyIds.has(String(edge.targetNode?.id)))
    .map((edge) => {
      const item = clone(edge.value);
      item.id = getNextBlueprintEdgeId(edgeRows, reservedEdgeIds);
      setByPath(item, 'from.node', idMap.get(String(edge.sourceNode.id)));
      setByPath(item, 'to.node', idMap.get(String(edge.targetNode.id)));
      return item;
    });
  if (tree && parentEdge) {
    const item = clone(parentEdge.value);
    item.id = getNextBlueprintEdgeId(edgeRows, reservedEdgeIds);
    setByPath(item, 'to.node', idMap.get(String(node.id)));
    copiedEdges.push(item);
  }

  nodeRows.push(...copiedRows);
  edgeRows.push(...copiedEdges);
  setByPath(state.data, graph.spec.nodes, nodeRows);
  setByPath(state.data, graph.spec.edges, edgeRows);
  const copiedId = idMap.get(String(node.id));
  state.selectedKey = `${graph.spec.nodes}:${copiedId}`;
  state.selectedEdge = null;
  markDirtyAndRender(tree ? '已复制当前分支' : '已复制节点');
  return true;
}

function getBlueprintSubtreeNodes(node, graph) {
  const result = [];
  const pending = [node];
  const visited = new Set();
  while (pending.length) {
    const current = pending.pop();
    if (!current || visited.has(current.key)) {
      continue;
    }
    visited.add(current.key);
    result.push(current);
    (current.outgoing || [])
      .filter((edge) => edge.kind === 'control')
      .forEach((edge) => pending.push(graph.nodeMap.get(edge.to)));
  }
  return result;
}

function deleteBlueprintBranch(node, graph = buildBlueprintModel()) {
  const tree = getGraphAlgorithm() === 'tree';
  const removed = tree ? getBlueprintSubtreeNodes(node, graph) : [node];
  const removedIds = new Set(removed.map((candidate) => String(candidate.id)));
  const root = node.typeSpec?.category === 'root';
  const label = root
    ? '清空整棵树'
    : (tree ? `删除当前分支及其 ${Math.max(0, removed.length - 1)} 个子节点` : '删除节点');
  if (!window.confirm(`${label}？`)) {
    return false;
  }

  const nodeRows = ensureArray(getByPath(state.data, graph.spec.nodes));
  const edgeRows = ensureArray(getByPath(state.data, graph.spec.edges));
  pushHistory(label);
  setByPath(state.data, graph.spec.nodes, nodeRows.filter((item) => (
    !removedIds.has(String(getByPath(item, graph.spec.nodeId)))
  )));
  setByPath(state.data, graph.spec.edges, edgeRows.filter((item) => (
    !removedIds.has(String(getByPath(item, 'from.node')))
      && !removedIds.has(String(getByPath(item, 'to.node')))
  )));
  state.selectedKey = '';
  state.selectedEdge = null;
  markDirtyAndRender(root ? '行为树已清空' : '分支已删除');
  return true;
}

function runGenericGraphContextAction(actionId) {
  const graph = buildGraphModel();
  const node = graph.nodeMap.get(state.contextGraphNodeKey || state.selectedKey);
  if (!node || isVirtualGraphNode(node)) {
    hideGraphContextMenu();
    return;
  }

  const action = getGenericGraphMutationActions(node, graph).find((item) => item.id === actionId);
  if (action) {
    runGenericGraphMutation(node, action, graph);
  }
  hideGraphContextMenu();
}

function getGenericGraphMutationActions(node, graph) {
  const configured = state.domain?.graph?.mutations || state.domain?.graph?.actions || {};
  const collectionActions = configured[node.collection] || configured[singular(node.collection)] || [];
  return ensureArray(collectionActions)
    .map(normalizeGenericGraphMutation)
    .filter((action) => action.id && isGenericGraphMutationVisible(action, node, graph));
}

function normalizeGenericGraphMutation(action) {
  const item = typeof action === 'string' ? { type: action } : { ...(action || {}) };
  const type = String(item.type || item.action || item.kind || item.id || '').trim();
  return {
    ...item,
    id: String(item.id || type).trim(),
    type
  };
}

function isGenericGraphMutationVisible(action, node) {
  const rule = action.when || action.visibleWhen;
  if (!rule) {
    return true;
  }
  if (rule.collection && String(rule.collection) !== String(node.collection)) {
    return false;
  }
  const value = getByPath(node.value, rule.path || '');
  if (rule.empty) {
    return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
  }
  if (rule.notEmpty) {
    return !(value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0));
  }
  if (Object.prototype.hasOwnProperty.call(rule, 'equals')) {
    return String(value) === String(rule.equals);
  }
  if (Array.isArray(rule.oneOf)) {
    return rule.oneOf.map(String).includes(String(value));
  }
  return true;
}

function getGenericGraphMutationLabel(action) {
  if (action.type === 'delete') {
    return getAppLabel('delete');
  }
  if (action.type === 'append' || action.type === 'add-child' || action.type === 'add-reference') {
    return getAppLabel('add');
  }
  if (action.type === 'chain' || action.type === 'add-next') {
    return getGraphLabel('contextAddNext', getAppLabel('add'));
  }
  return action.id || getAppLabel('add');
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
  pushHistory(formatGraphLabel('historyAddNextNode', '从 #{id} 添加后续节点', { id: node.id }));
  const created = createDialogNode(kind, node.actorId || getDefaultDialogActorId(1));
  created.next = Number(created.kind) === 5 ? 0 : (Number(node.next) || 0);
  node.next = created.id;
  nodes.push(created);
  selectDialogGraphNode(state.domain.graph?.nodes || 'nodes', created.id);
  markDirtyAndRender(formatGraphLabel('statusAddedNode', '已添加节点 #{id}', { id: created.id }));
}

function addDialogNextFromOption(optionId, kind = 0) {
  const option = findDialogOption(optionId);
  if (!option) {
    return;
  }

  const nodes = getDialogNodes();
  pushHistory(formatGraphLabel('historyAddOptionNextNode', '从选项 #{id} 添加后续节点', { id: option.id }));
  const created = createDialogNode(kind, option.actorId || getDefaultDialogActorId(1));
  created.next = Number(created.kind) === 5 ? 0 : (Number(option.next) || 0);
  option.next = created.id;
  nodes.push(created);
  selectDialogGraphNode(state.domain.graph?.nodes || 'nodes', created.id);
  markDirtyAndRender(formatGraphLabel('statusAddedNode', '已添加节点 #{id}', { id: created.id }));
}

function addDialogBranchNode(nodeId, kind = 0) {
  const node = findDialogNode(nodeId);
  if (!node) {
    return;
  }

  const nodes = getDialogNodes();
  const options = getDialogOptions();
  pushHistory(formatGraphLabel('historyAddBranch', '从 #{id} 添加分支', { id: node.id }));
  if (Number(node.kind) === 1) {
    const nextNode = createDialogNode(kind, getDefaultDialogActorId(1));
    const option = createDialogOption(getDefaultDialogActorId(0), nextNode.id);
    nodes.push(nextNode);
    options.push(option);
    node.optionIds = ensureArray(node.optionIds);
    node.optionIds.push(option.id);
    selectDialogGraphNode(state.domain.graph?.options || state.domain.model?.options || 'options', option.id);
    markDirtyAndRender(formatGraphLabel('statusAddedOption', '已添加选项 #{id}', { id: option.id }));
    return;
  }

  if (Number(node.kind) === 2 || Number(node.kind) === 4) {
    const failNode = createDialogNode(kind, getDefaultDialogActorId(1));
    failNode.next = Number(failNode.kind) === 5 ? 0 : (Number(node.fail) || 0);
    node.fail = failNode.id;
    nodes.push(failNode);
    selectDialogGraphNode(state.domain.graph?.nodes || 'nodes', failNode.id);
    markDirtyAndRender(formatGraphLabel('statusAddedFailNode', '已添加失败节点 #{id}', { id: failNode.id }));
    return;
  }

  state.history.undo.pop();
  addDialogNextNode(nodeId, kind);
}

function deleteDialogNode(nodeId) {
  const node = findDialogNode(nodeId);
  if (!node || !window.confirm(formatGraphLabel('confirmDeleteNode', '删除节点 #{id}？', { id: nodeId }))) {
    return;
  }

  pushHistory(formatGraphLabel('historyDeleteNode', '删除节点 #{id}', { id: nodeId }));
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
  markDirtyAndRender(formatGraphLabel('statusDeletedNode', '已删除节点 #{id}', { id: nodeId }));
}

function deleteDialogOption(optionId) {
  if (!findDialogOption(optionId) || !window.confirm(formatGraphLabel('confirmDeleteOption', '删除选项 #{id}？', { id: optionId }))) {
    return;
  }

  pushHistory(formatGraphLabel('historyDeleteOption', '删除选项 #{id}', { id: optionId }));
  const keptOptions = getDialogOptions().filter((option) => String(option.id) !== String(optionId));
  setByPath(state.data, state.domain.graph?.options || state.domain.model?.options || 'options', keptOptions);
  getDialogNodes().forEach((node) => {
    if (Array.isArray(node.optionIds)) {
      node.optionIds = node.optionIds.filter((id) => String(id) !== String(optionId));
    }
  });
  state.selectedKey = '';
  state.selectedEdge = null;
  markDirtyAndRender(formatGraphLabel('statusDeletedOption', '已删除选项 #{id}', { id: optionId }));
}

function renderGraph() {
  renderBlueprintGuide(null);
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
  let layout = layoutBlueprintGraph(model);
  graphNodes.innerHTML = '';
  graphEdges.innerHTML = '';
  graphView.dataset.layout = 'blueprint';
  graphView.dataset.profile = getBlueprintProfile(viewSpec);
  renderBlueprintGuide(viewSpec);
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
      if (event.button !== 0 || !isFreeGraph()) {
        return;
      }
      startGraphDrag(event, node, item, pos);
    });
    graphNodes.append(item);
  }

  if (getGraphAlgorithm() === 'tree') {
    layout = layoutBlueprintGraph(model, measureBlueprintNodeSizes(layout.sizes));
    layout.positions.forEach((pos, key) => {
      const item = graphNodes.querySelector(`[data-key="${CSS.escape(key)}"]`);
      if (item) {
        item.style.left = `${pos.x}px`;
        item.style.top = `${pos.y}px`;
      }
    });
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
    profile: viewSpec?.profile || spec.profile || state.domain?.graph?.profile || '',
    nodes: viewSpec?.target || spec.nodes || state.domain?.graph?.nodes || state.domain?.model?.nodes || 'nodes',
    edges: viewSpec?.edges || spec.edges || state.domain?.model?.edges || 'edges',
    nodeId: spec.nodeId || state.domain?.graph?.nodeId || 'id',
    nodeType: spec.nodeType || 'type',
    values: spec.values || 'values',
    note: spec.note || '',
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
    description: type.description || '',
    color: type.color || '',
    category: type.category || '',
    icon: type.icon || '',
    ports,
    inputs: ports.filter((port) => port.direction === 'input'),
    outputs: ports.filter((port) => port.direction === 'output')
  };
}

function getBlueprintProfile(viewSpec = null) {
  return String(getBlueprintSpec(viewSpec).profile || '').trim().toLowerCase();
}

function isBehaviorTreeBlueprint(viewSpec = null) {
  return getBlueprintProfile(viewSpec) === 'behavior-tree';
}

function renderBlueprintGuide(viewSpec = null) {
  if (!graphGuide) {
    return;
  }
  if (!viewSpec && !isBlueprintGraph()) {
    graphGuide.classList.add('hidden');
    graphGuide.innerHTML = '';
    return;
  }
  if (!isBehaviorTreeBlueprint(viewSpec)) {
    graphGuide.classList.add('hidden');
    graphGuide.innerHTML = '';
    return;
  }

  const description = String(state.data?.description || '').trim();
  graphGuide.innerHTML = `
    <div class="graph-guide__eyebrow">如何阅读</div>
    ${description ? `<div class="graph-guide__description">${escapeHtml(description)}</div>` : '<div class="graph-guide__description graph-guide__description--empty">请在文件信息中补充整棵树的用途。</div>'}
    <div class="graph-guide__rule">从上到下执行，同层数字越小越先。节点会返回成功、失败或运行中；父节点如何处理结果，以复合节点卡片的说明为准。</div>
    <div class="graph-guide__shortcut">右键节点：编辑、添加子节点、排序、复制或删除分支；按住右键拖动画布。</div>
    <div class="graph-guide__legend" aria-label="行为树节点分类">
      <span class="is-root">根</span>
      <span class="is-composite">复合</span>
      <span class="is-decorator">装饰</span>
      <span class="is-condition">条件</span>
      <span class="is-action">动作</span>
    </div>
  `;
  graphGuide.classList.remove('hidden');
}

function getBlueprintPort(node, portId, direction = '') {
  const ports = node.typeSpec?.ports || [];
  return ports.find((port) => port.id === portId && (!direction || port.direction === direction)) || null;
}

function layoutBlueprintGraph(model, measuredSizes = null) {
  const grid = getGraphGridSize();
  const positions = new Map();
  const sizes = new Map();
  model.nodes.forEach((node, index) => {
    const saved = getNodeGridPosition(node);
    positions.set(node.key, saved
      ? { x: saved.x * grid, y: saved.y * grid }
      : { x: 80 + index * 300, y: 100 });
    sizes.set(node.key, measuredSizes?.get(node.key) || {
      width: isBehaviorTreeBlueprint() ? 224 : 280,
      height: isBehaviorTreeBlueprint()
        ? 92
        : Math.max(150, 74 + Math.max(node.typeSpec?.inputs?.length || 0, node.typeSpec?.outputs?.length || 0) * 30)
    });
  });
  if (getGraphAlgorithm() === 'tree') {
    return layoutBlueprintTree(model, sizes);
  }
  const width = Math.max(1100, maxGraphExtent(positions, sizes, 'x') + FIXED_GRAPH_MARGIN);
  const height = Math.max(720, maxGraphExtent(positions, sizes, 'y') + FIXED_GRAPH_MARGIN);
  return { ...model, positions, sizes, portAnchors: new Map(), edges: model.edges, width, height };
}

function measureBlueprintNodeSizes(fallback) {
  const sizes = new Map(fallback || []);
  graphNodes.querySelectorAll('.blueprint-node').forEach((item) => {
    const key = item.dataset.key;
    if (!key) {
      return;
    }
    sizes.set(key, {
      width: item.offsetWidth || sizes.get(key)?.width || 280,
      height: item.offsetHeight || sizes.get(key)?.height || 150
    });
  });
  return sizes;
}

function layoutBlueprintTree(model, sizes) {
  const horizontalGap = 34;
  const verticalGap = 84;
  const margin = 80;
  const controlEdges = model.edges.filter((edge) => edge.kind === 'control');
  const children = new Map(model.nodes.map((node) => [node.key, []]));
  const incoming = new Map(model.nodes.map((node) => [node.key, 0]));
  controlEdges.forEach((edge) => {
    if (!children.has(edge.from) || !incoming.has(edge.to)) {
      return;
    }
    children.get(edge.from).push(edge.to);
    incoming.set(edge.to, incoming.get(edge.to) + 1);
  });
  children.forEach((keys) => keys.sort((left, right) => {
    const leftNode = model.nodeMap.get(left);
    const rightNode = model.nodeMap.get(right);
    const valuesPath = model.spec.values || 'values';
    const leftOrder = Number(getByPath(leftNode?.value, `${valuesPath}.order`) ?? leftNode?.id ?? 0);
    const rightOrder = Number(getByPath(rightNode?.value, `${valuesPath}.order`) ?? rightNode?.id ?? 0);
    return leftOrder - rightOrder || Number(leftNode?.id || 0) - Number(rightNode?.id || 0);
  }));

  const subtreeWidths = new Map();
  const visiting = new Set();
  function subtreeWidth(key) {
    if (subtreeWidths.has(key)) {
      return subtreeWidths.get(key);
    }
    const own = sizes.get(key)?.width || 224;
    if (visiting.has(key)) {
      return own;
    }
    visiting.add(key);
    const childKeys = children.get(key) || [];
    const childWidth = childKeys.reduce((sum, childKey, index) => (
      sum + subtreeWidth(childKey) + (index > 0 ? horizontalGap : 0)
    ), 0);
    visiting.delete(key);
    const width = Math.max(own, childWidth);
    subtreeWidths.set(key, width);
    return width;
  }

  const depth = new Map();
  const depthHeights = new Map();
  function measureDepth(key, level, path = new Set()) {
    if (path.has(key)) {
      return;
    }
    const previous = depth.get(key);
    if (previous !== undefined && previous <= level) {
      return;
    }
    depth.set(key, level);
    depthHeights.set(level, Math.max(depthHeights.get(level) || 0, sizes.get(key)?.height || 92));
    const nextPath = new Set(path);
    nextPath.add(key);
    (children.get(key) || []).forEach((child) => measureDepth(child, level + 1, nextPath));
  }

  const roots = model.nodes
    .filter((node) => (incoming.get(node.key) || 0) === 0)
    .sort((left, right) => Number(left.id || 0) - Number(right.id || 0));
  roots.forEach((root) => measureDepth(root.key, 0));
  const levelY = new Map();
  let nextY = margin;
  const maxLevel = Math.max(0, ...depthHeights.keys());
  for (let level = 0; level <= maxLevel; level += 1) {
    levelY.set(level, nextY);
    nextY += (depthHeights.get(level) || 92) + verticalGap;
  }

  const positions = new Map();
  const placed = new Set();
  function place(key, level, left, path = new Set()) {
    if (placed.has(key) || path.has(key)) {
      return;
    }
    const nextPath = new Set(path);
    nextPath.add(key);
    const width = subtreeWidth(key);
    const own = sizes.get(key)?.width || 224;
    positions.set(key, {
      x: left + Math.max(0, (width - own) / 2),
      y: levelY.get(level) ?? nextY
    });
    placed.add(key);
    const childKeys = children.get(key) || [];
    const childrenWidth = childKeys.reduce((sum, childKey, index) => (
      sum + subtreeWidth(childKey) + (index > 0 ? horizontalGap : 0)
    ), 0);
    let childLeft = left + Math.max(0, (width - childrenWidth) / 2);
    childKeys.forEach((childKey) => {
      place(childKey, level + 1, childLeft, nextPath);
      childLeft += subtreeWidth(childKey) + horizontalGap;
    });
  }

  let forestLeft = margin;
  roots.forEach((root) => {
    place(root.key, 0, forestLeft);
    forestLeft += subtreeWidth(root.key) + horizontalGap * 2;
  });
  model.nodes.filter((node) => !placed.has(node.key)).forEach((node) => {
    positions.set(node.key, { x: forestLeft, y: nextY });
    forestLeft += (sizes.get(node.key)?.width || 224) + horizontalGap;
    placed.add(node.key);
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
  const vertical = getGraphAlgorithm() === 'tree';
  const handle = vertical
    ? Math.max(46, Math.abs(end.y - start.y) * 0.42)
    : Math.max(80, Math.abs(end.x - start.x) * 0.5);
  return {
    ...edge,
    startX: start.x,
    startY: start.y,
    endX: end.x,
    endY: end.y,
    labelX: (start.x + end.x) / 2,
    labelY: (start.y + end.y) / 2,
    path: vertical
      ? `M ${start.x} ${start.y} C ${start.x} ${start.y + handle}, ${end.x} ${end.y - handle}, ${end.x} ${end.y}`
      : `M ${start.x} ${start.y} C ${start.x + handle} ${start.y}, ${end.x - handle} ${end.y}, ${end.x} ${end.y}`
  };
}

function getBlueprintNodeClassName(node) {
  const classes = ['graph-node', 'blueprint-node'];
  if (isBehaviorTreeBlueprint()) {
    classes.push('behavior-tree-node');
    classes.push(`behavior-tree-node--${node.typeSpec?.category || 'action'}`);
  }
  if (!node.typeSpec) {
    classes.push('blueprint-node--invalid');
  }
  return classes.join(' ');
}

function renderBlueprintNodeContent(node) {
  if (isBehaviorTreeBlueprint()) {
    return renderBehaviorTreeNodeContent(node);
  }
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

function renderBehaviorTreeNodeContent(node) {
  const inputs = (node.typeSpec?.inputs || []).filter((port) => port.kind === 'control');
  const outputs = (node.typeSpec?.outputs || []).filter((port) => port.kind === 'control');
  const data = (node.typeSpec?.inputs || [])
    .filter((port) => port.kind === 'data' && port.id !== 'order')
    .map((port) => ({ port, value: getBlueprintPortDisplayValue(node, port) }))
    .filter((entry) => entry.value !== '')
    .slice(0, 4);
  const orderPort = (node.typeSpec?.inputs || []).find((port) => port.id === 'order');
  const order = orderPort ? getBlueprintPortDisplayValue(node, orderPort) : '';
  const category = node.typeSpec?.category || 'action';
  const description = String(node.typeSpec?.description || '').trim();
  const notePath = getBlueprintSpec().note;
  const note = notePath ? String(getByPath(node.value, notePath) || '').trim() : '';
  const labels = {
    root: '根',
    composite: '复合',
    decorator: '装饰',
    condition: '条件',
    action: '动作'
  };
  return `
    ${inputs.map((port) => `<span class="blueprint-port blueprint-port--control behavior-tree-node__connector behavior-tree-node__connector--input" data-port-id="${escapeHtml(port.id)}" data-port-direction="input" title="${escapeHtml(port.label || port.id)}"></span>`).join('')}
    <div class="behavior-tree-node__head">
      <span class="behavior-tree-node__category">${escapeHtml(labels[category] || category)}</span>
      <span class="behavior-tree-node__title">${escapeHtml(node.typeSpec?.title || node.typeId || 'Unknown')}</span>
      ${order !== '' ? `<span class="behavior-tree-node__order">${escapeHtml(order)}</span>` : `<span class="behavior-tree-node__id">#${escapeHtml(node.id)}</span>`}
    </div>
    ${description ? `<div class="behavior-tree-node__description" title="${escapeHtml(description)}">${escapeHtml(description)}</div>` : ''}
    ${note ? `<div class="behavior-tree-node__note"><b>本节点</b>${escapeHtml(note)}</div>` : ''}
    ${data.length ? `<div class="behavior-tree-node__facts">${data.map(({ port, value }) => `<span><b>${escapeHtml(port.label || port.id)}</b>${escapeHtml(value)}</span>`).join('')}</div>` : ''}
    ${outputs.map((port) => `<span class="blueprint-port blueprint-port--control behavior-tree-node__connector behavior-tree-node__connector--output" data-port-id="${escapeHtml(port.id)}" data-port-direction="output" title="${escapeHtml(port.label || port.id)}"></span>`).join('')}
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
  graphView.dataset.profile = getBlueprintProfile();
  applyGraphLayoutSurface(layout);
  drawBlueprintEdges(layout);
}

function drawGraphLayout(graph, layout) {
  graphNodes.innerHTML = '';
  graphView.dataset.layout = getGraphLayoutMode();
  graphView.dataset.profile = getGraphProfileId();
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
    if (size?.width) {
      item.style.width = `${size.width}px`;
    }
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
    bindStateMachineEdgeContextMenu(line, edge, edgeKey);
    graphEdges.append(line);

    const hitPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    hitPath.classList.add('graph-edge-hit');
    hitPath.setAttribute('d', edge.path);
    hitPath.addEventListener('click', (event) => {
      event.stopPropagation();
      selectGraphEdge(edge, edgeKey);
    });
    bindStateMachineEdgeContextMenu(hitPath, edge, edgeKey);
    graphEdges.append(hitPath);

    if (edge.label) {
      const labelX = edge.labelX ?? ((edge.startX + edge.endX) / 2);
      const labelY = edge.labelY ?? ((edge.startY + edge.endY) / 2);
      const lines = String(edge.label).split('\n');
      if (isStateMachineProfile()) {
        const labelWidth = Math.max(64, Math.min(210, ...lines.map((label) => (
          [...label].reduce((width, character) => width + (character.charCodeAt(0) > 255 ? 10 : 6.2), 0) + 18
        ))));
        const labelHeight = lines.length * 13 + 8;
        const background = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        background.classList.add('graph-edge__label-bg');
        if (edge.route) {
          background.classList.add(`graph-edge__label-bg--${edge.route}`);
        }
        if (edgeSelected) {
          background.classList.add('graph-edge__label-bg--highlight');
        }
        background.setAttribute('x', String(labelX - labelWidth / 2));
        background.setAttribute('y', String(labelY - 13));
        background.setAttribute('width', String(labelWidth));
        background.setAttribute('height', String(labelHeight));
        background.setAttribute('rx', '6');
        background.addEventListener('click', (event) => {
          event.stopPropagation();
          selectGraphEdge(edge, edgeKey);
        });
        bindStateMachineEdgeContextMenu(background, edge, edgeKey);
        graphEdges.append(background);
      }

      const text = document.createElementNS('http://www.w3.org/2000/svg', 'text');
      text.classList.add('graph-edge__label');
      if (edgeSelected) {
        text.classList.add('graph-edge__label--highlight');
      }
      text.setAttribute('x', String(labelX));
      text.setAttribute('y', String(labelY));
      text.setAttribute('text-anchor', 'middle');
      if (isStateMachineProfile()) {
        const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
        title.textContent = getStateMachineEdgeTooltip(edge);
        text.append(title);
      }
      lines.forEach((label, lineIndex) => {
        const span = document.createElementNS('http://www.w3.org/2000/svg', 'tspan');
        span.setAttribute('x', String(labelX));
        span.setAttribute('dy', lineIndex === 0 ? '0' : '1.25em');
        span.textContent = label;
        text.append(span);
      });
      text.addEventListener('click', (event) => {
        event.stopPropagation();
        selectGraphEdge(edge, edgeKey);
      });
      bindStateMachineEdgeContextMenu(text, edge, edgeKey);
      graphEdges.append(text);
    }
  });
}

function bindStateMachineEdgeContextMenu(element, edge, edgeKey) {
  if (!isStateMachineProfile() || !edge?.dataPath) {
    return;
  }
  element.addEventListener('contextmenu', (event) => {
    event.preventDefault();
    event.stopPropagation();
    showStateMachineEdgeContextMenu(event.clientX, event.clientY, edge, edgeKey);
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
  graphView.dataset.profile = getGraphProfileId();
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
  return edge.dataPath
    ? `edge:${edge.dataPath}`
    : `${edge.from}->${edge.to}:${edge.field || edge.kind || 'edge'}:${index}`;
}

function isGraphEdgeSelected(edgeKey, edge) {
  if (state.selectedKey === edgeKey) {
    return true;
  }
  if (state.selectedEdge?.dataPath || edge.dataPath) {
    return !!state.selectedEdge?.dataPath && state.selectedEdge.dataPath === edge.dataPath;
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
  if (edge.route) {
    path.classList.add(`graph-edge--state-${edge.route}`);
  }
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
  if (edge.route === 'return' || edge.route === 'self') {
    path.classList.add('graph-edge--back');
  } else if (!edge.route && edge.endY !== undefined && edge.startY !== undefined && edge.endY <= edge.startY) {
    path.classList.add('graph-edge--back');
  }
}

function getStateMachineEdgeTooltip(edge) {
  const triggerLabels = { tick: '每帧', success: '成功', failure: '失败' };
  const source = edge.sourceValue || {};
  return [
    source.label || String(edge.label || '').split('\n')[0],
    triggerLabels[source.trigger] || source.trigger || '',
    source.condition ? `条件 ${source.condition}` : '',
    Number(source.priority || 0) ? `优先级 ${source.priority}` : ''
  ].filter(Boolean).join(' · ');
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
    for (const [sourceIndex, item] of items.entries()) {
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
            dataPath: joinGraphDataPath(`${path}[${sourceIndex}]`, target.sourcePath),
            targetValue: targetNode?.value || null,
            sourceNode,
            targetNode
          });
        }
      }
    }
  }

  appendDerivedGraphEdges(config, nodes, nodeMap, baseCollection, edges);

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

function appendDerivedGraphEdges(config, nodes, nodeMap, baseCollection, edges) {
  const derived = config?.derivedEdges;
  const type = String(derived?.type || derived?.kind || '').trim().toLowerCase();
  if (type !== 'orthogonal-grid') {
    return;
  }

  const baseNodes = nodes.filter((node) => node.collection === baseCollection);
  const knownPairs = new Set(edges.map((edge) => graphNodePairKey(edge.from, edge.to)));
  const links = ensureArray(getByPath(state.data, derived.links || ''));
  if (links.length > 0) {
    const fromPath = derived.from || 'from';
    const toPath = derived.to || 'to';
    links.forEach((link) => {
      appendDerivedGraphEdge(
        String(getByPath(link, fromPath) ?? ''),
        String(getByPath(link, toPath) ?? ''),
        derived,
        baseCollection,
        nodeMap,
        edges,
        knownPairs
      );
    });
    return;
  }

  const position = derived.position || config.position || { x: 'x', y: 'y' };
  for (let leftIndex = 0; leftIndex < baseNodes.length; leftIndex += 1) {
    const left = baseNodes[leftIndex];
    const leftPoint = getDerivedGridPoint(left.value, position);
    if (!leftPoint) continue;
    for (let rightIndex = leftIndex + 1; rightIndex < baseNodes.length; rightIndex += 1) {
      const right = baseNodes[rightIndex];
      const rightPoint = getDerivedGridPoint(right.value, position);
      if (!rightPoint || Math.abs(leftPoint.x - rightPoint.x) + Math.abs(leftPoint.y - rightPoint.y) !== 1) {
        continue;
      }
      appendDerivedGraphEdge(
        left.id,
        right.id,
        derived,
        baseCollection,
        nodeMap,
        edges,
        knownPairs
      );
    }
  }
}

function getDerivedGridPoint(value, position) {
  const xPath = position && typeof position === 'object' && !Array.isArray(position) ? (position.x || 'x') : `${position}.x`;
  const yPath = position && typeof position === 'object' && !Array.isArray(position) ? (position.y || 'y') : `${position}.y`;
  const x = Number(getByPath(value, xPath));
  const y = Number(getByPath(value, yPath));
  return Number.isInteger(x) && Number.isInteger(y) ? { x, y } : null;
}

function appendDerivedGraphEdge(fromId, toId, derived, baseCollection, nodeMap, edges, knownPairs) {
  if (!fromId || !toId || fromId === toId) {
    return;
  }
  const from = `${baseCollection}:${fromId}`;
  const to = `${baseCollection}:${toId}`;
  const sourceNode = nodeMap.get(from);
  const targetNode = nodeMap.get(to);
  const pairKey = graphNodePairKey(from, to);
  if (!sourceNode || !targetNode || knownPairs.has(pairKey)) {
    return;
  }
  knownPairs.add(pairKey);
  edges.push({
    from,
    to,
    sourceCollection: baseCollection,
    targetCollection: baseCollection,
    field: '__derived',
    kind: derived.edgeKind || derived.kind || 'grid',
    color: derived.color || '',
    tone: derived.tone || '',
    label: derived.label || '',
    rule: 'derived:orthogonal-grid',
    sourceValue: sourceNode.value,
    targetValue: targetNode.value,
    sourceNode,
    targetNode
  });
}

function graphNodePairKey(left, right) {
  return String(left) < String(right) ? `${left}\n${right}` : `${right}\n${left}`;
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
  let current = [{ value: root, sourceValue: root, sourcePath: '' }];
  parts.forEach((part, index) => {
    const isLast = index === parts.length - 1;
    const next = [];
    current.forEach((entry) => {
      const value = entry.value;
      if (Array.isArray(value)) {
        value.forEach((item, itemIndex) => {
          const child = getGraphEdgeChildValue(item, part);
          const itemPath = `${entry.sourcePath}[${itemIndex}]`;
          next.push({
            value: child,
            sourceValue: isLast ? item : child,
            sourcePath: isLast ? itemPath : joinGraphDataPath(itemPath, part)
          });
        });
        return;
      }
      const child = getGraphEdgeChildValue(value, part);
      next.push({
        value: child,
        sourceValue: isLast ? value : child,
        sourcePath: isLast ? entry.sourcePath : joinGraphDataPath(entry.sourcePath, part)
      });
    });
    current = next;
  });
  return current.filter((entry) => entry.value !== undefined);
}

function joinGraphDataPath(base, relative) {
  if (!relative) {
    return base;
  }
  if (!base) {
    return relative;
  }
  return relative.startsWith('[') ? `${base}${relative}` : `${base}.${relative}`;
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

function formatGraphLabel(key, fallback, values = {}) {
  return String(getGraphLabel(key, fallback)).replace(/\{([^}]+)\}/g, (_, name) => values[name] ?? '');
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
  let label = '';
  if (rule.label) {
    label = String(rule.label);
  }
  if (rule.labelPath) {
    const value = getByPath(sourceValue, rule.labelPath);
    if (value !== undefined && value !== null && value !== '') {
      label = String(value);
    }
  }
  if (isStateMachineProfile()) {
    const triggerLabels = { tick: '每帧', success: '成功', failure: '失败' };
    const trigger = triggerLabels[sourceValue?.trigger] || sourceValue?.trigger || '';
    const condition = String(sourceValue?.condition || '').trim();
    const priority = Number(sourceValue?.priority || 0);
    const detail = [trigger, condition ? '有条件' : '', priority ? `P${priority}` : '']
      .filter(Boolean)
      .join(' · ');
    if (label && detail) {
      return `${label}\n${detail}`;
    }
    return label || detail;
  }
  if (label) {
    return label;
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
  if (isStateMachineProfile()) {
    classes.push('graph-node--state-machine');
    const viewState = String(node.value?.view_state || '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
    if (viewState) {
      classes.push(`graph-node--state-${viewState}`);
    }
    if (node.key === graph.entry) {
      classes.push('graph-node--initial-state');
    }
    if (node.value?.parent) {
      classes.push('graph-node--child-state');
    }
  }
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
    if (isStateMachineProfile() && node.virtual === 'start') {
      return `
        <div class="state-machine-entry__dot"></div>
        <div class="state-machine-entry__label">初始</div>
      `;
    }
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
  if (isStateMachineProfile()) {
    const initial = node.key === graph.entry;
    const viewState = formatStateMachineViewState(node.value?.view_state);
    return {
      kindLabel: initial ? `初始 · ${viewState}` : viewState,
      actorName: String(node.value?.label || node.value?.name || node.id),
      faceText: '',
      text: String(node.value?.description || '未填写状态说明'),
      detailLines: [
        `行为树 · ${node.value?.tree || '未设置'}`,
        node.value?.parent ? `父状态 · ${node.value.parent}` : ''
      ].filter(Boolean)
    };
  }
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

function formatStateMachineViewState(value) {
  const id = String(value || '').trim().toLowerCase();
  const labels = {
    active: '行动',
    windup: '前摇',
    attack: '攻击',
    hidden: '潜伏',
    dormant: '休眠'
  };
  return labels[id] || String(value || '状态');
}

function hasConfiguredGraphNodeView() {
  return !!(state.domain?.graph?.nodeView || state.domain?.graph?.nodeViews) && !isDialogGraphProfile();
}

function buildConfiguredGraphNodeView(node, graph) {
  const configuredViews = state.domain?.graph?.nodeViews || {};
  const config = configuredViews[node.collection]
    || configuredViews[singular(node.collection)]
    || state.domain?.graph?.nodeView
    || {};
  const detailPaths = ensureArray(config.details, { scalar: true });
  const detailLines = detailPaths
    .map((pathText) => formatConfiguredGraphDetail(node, graph, pathText))
    .filter(Boolean);
  return {
    kindLabel: formatConfiguredGraphValue(node, graph, config.badge, getGraphLabel('nodeKind', '节点'), { kindLabel: true }),
    actorName: formatConfiguredGraphValue(node, graph, config.title, node.title || node.id),
    faceText: '',
    text: formatConfiguredGraphValue(node, graph, config.body, ''),
    detailLines
  };
}

function formatConfiguredGraphDetail(node, graph, detailSpec) {
  const configured = detailSpec && typeof detailSpec === 'object' && !Array.isArray(detailSpec)
    ? detailSpec
    : { path: detailSpec };
  const text = String(configured.path || configured.value || '').trim();
  if (!text) {
    return '';
  }
  const value = getConfiguredGraphRawValue(node, graph, text);
  if (value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length)) {
    return '';
  }
  const label = configured.label || formatGraphDetailLabel(text, node);
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

function formatGraphDetailLabel(pathText, node = null) {
  const formLabel = getGraphNodeFormLabel(pathText, node);
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

function getGraphNodeFormLabel(pathText, node = null) {
  const targetPath = String(pathText || '').trim();
  if (!targetPath) {
    return '';
  }

  const forms = state.domain?.inspector?.forms || {};
  const kind = node?.value?.[state.domain?.graph?.nodeKind || 'kind'];
  const graphNodeForm = (node && forms[`${node.collection}:${kind}`])
    || (node && forms[node.collection])
    || forms.graphNode;
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
  if (isStateMachineProfile()) {
    return Math.max(148, 68
      + actorLines * GRAPH_ACTOR_LINE_HEIGHT
      + textLines * GRAPH_TEXT_LINE_HEIGHT
      + detailHeight);
  }
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
    width: isStateMachineProfile() ? 220 : GRAPH_NODE_WIDTH,
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
  if (isStateMachineProfile() && !isFreeGraph()) {
    return layoutStateMachineGraph(graph, sizeOverrides);
  }
  return isFreeGraph()
    ? layoutFreeGraph(graph, sizeOverrides)
    : layoutFixedGraph(graph, sizeOverrides);
}

function layoutStateMachineGraph(graph, sizeOverrides = null) {
  const ordered = [...graph.nodes].sort((left, right) => {
    const depthDelta = getStateParentDepth(left, graph) - getStateParentDepth(right, graph);
    if (depthDelta !== 0) {
      return depthDelta;
    }
    const orderDelta = Number(left.value?.order || 0) - Number(right.value?.order || 0);
    return orderDelta !== 0 ? orderDelta : left.key.localeCompare(right.key, 'en', { numeric: true });
  });
  const startNode = {
    key: START_NODE_KEY,
    id: getGraphLabel('startKind', '初始'),
    collection: '__virtual__',
    title: getGraphLabel('startKind', '初始'),
    text: '',
    value: null,
    virtual: 'start'
  };
  const displayNodes = graph.entry ? [startNode, ...ordered] : ordered;
  const sizes = new Map(displayNodes.map((node) => [
    node.key,
    node.key === START_NODE_KEY ? { width: 76, height: 76 } : getGraphNodeSize(node, graph, sizeOverrides)
  ]));
  const positions = new Map();
  const rowGroups = new Map();
  ordered.forEach((node) => {
    const depth = getStateParentDepth(node, graph);
    const row = rowGroups.get(depth) || [];
    row.push(node);
    rowGroups.set(depth, row);
  });

  const orderedIndex = new Map(ordered.map((node, index) => [node.key, index]));
  const stateDepth = new Map(ordered.map((node) => [node.key, getStateParentDepth(node, graph)]));
  const returnLaneCount = graph.edges.filter((edge) => (
    edge.from !== edge.to
      && orderedIndex.has(edge.from)
      && orderedIndex.has(edge.to)
      && (stateDepth.get(edge.from) !== stateDepth.get(edge.to)
        || orderedIndex.get(edge.to) <= orderedIndex.get(edge.from))
  )).length;
  const margin = 72;
  const stateStartX = 182;
  const stateGapX = 138;
  const stateGapY = 156;
  const returnLaneGap = 56;
  const stateTop = 132 + Math.max(0, returnLaneCount - 1) * returnLaneGap;
  let maxRight = stateStartX;
  let maxBottom = stateTop;
  [...rowGroups.entries()].sort(([left], [right]) => left - right).forEach(([depth, nodes]) => {
    let x = stateStartX;
    nodes.forEach((node) => {
      const size = sizes.get(node.key) || { width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT };
      const parent = node.value?.parent
        ? graph.nodes.find((candidate) => String(candidate.value?.name || candidate.id) === String(node.value.parent))
        : null;
      const parentPosition = parent ? positions.get(parent.key) : null;
      const parentSize = parent ? sizes.get(parent.key) : null;
      const preferredX = parentPosition
        ? parentPosition.x + ((parentSize?.width || GRAPH_NODE_WIDTH) - size.width) / 2
        : x;
      const y = stateTop + depth * stateGapY;
      positions.set(node.key, { x: Math.max(x, preferredX), y });
      x = Math.max(x, preferredX) + size.width + stateGapX;
      maxRight = Math.max(maxRight, x - stateGapX);
      maxBottom = Math.max(maxBottom, y + size.height);
    });
  });

  if (graph.entry && positions.has(graph.entry)) {
    const entry = positions.get(graph.entry);
    const startSize = sizes.get(START_NODE_KEY) || { width: 76, height: 76 };
    const entrySize = sizes.get(graph.entry) || { width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT };
    positions.set(START_NODE_KEY, {
      x: margin,
      y: entry.y + (entrySize.height - startSize.height) / 2
    });
  }

  const edges = [];
  if (graph.entry && positions.has(START_NODE_KEY) && positions.has(graph.entry)) {
    const start = positions.get(START_NODE_KEY);
    const target = positions.get(graph.entry);
    const startSize = sizes.get(START_NODE_KEY);
    const targetSize = sizes.get(graph.entry);
    const startX = start.x + startSize.width;
    const startY = start.y + startSize.height / 2;
    const endX = target.x;
    const endY = target.y + targetSize.height / 2;
    const handle = Math.max(44, (endX - startX) * 0.5);
    edges.push({
      from: START_NODE_KEY,
      to: graph.entry,
      field: 'start',
      kind: 'start',
      route: 'entry',
      label: '',
      startX,
      startY,
      endX,
      endY,
      minX: Math.min(startX, endX),
      maxX: Math.max(startX, endX),
      path: `M ${startX} ${startY} C ${startX + handle} ${startY}, ${endX - handle} ${endY}, ${endX} ${endY}`
    });
  }

  const returnEdges = graph.edges
    .filter((edge) => {
      if (edge.from === edge.to) {
        return false;
      }
      const from = positions.get(edge.from);
      const to = positions.get(edge.to);
      return from && to && !(to.x > from.x && Math.abs(to.y - from.y) < stateGapY / 2);
    })
    .sort((left, right) => {
      const leftSpan = Math.abs((positions.get(left.from)?.x || 0) - (positions.get(left.to)?.x || 0));
      const rightSpan = Math.abs((positions.get(right.from)?.x || 0) - (positions.get(right.to)?.x || 0));
      return leftSpan - rightSpan;
    });
  const returnLanes = new Map(returnEdges.map((edge, index) => [edge, index]));
  let selfLane = 0;
  let routeMaxRight = maxRight;
  graph.edges.forEach((edge) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    if (!from || !to) {
      return;
    }
    const fromSize = sizes.get(edge.from) || { width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT };
    const toSize = sizes.get(edge.to) || { width: GRAPH_NODE_WIDTH, height: GRAPH_NODE_HEIGHT };
    const self = edge.from === edge.to;
    const forward = !self && to.x > from.x && Math.abs(to.y - from.y) < stateGapY / 2;
    let startX;
    let startY;
    let endX;
    let endY;
    let labelX;
    let labelY;
    let path;
    let route;
    let label = edge.label;
    if (self) {
      startX = from.x + fromSize.width;
      startY = from.y + fromSize.height * 0.32;
      endX = startX;
      endY = from.y + fromSize.height * 0.72;
      const laneX = startX + 62 + selfLane * 34;
      selfLane += 1;
      labelX = laneX + 4;
      labelY = (startY + endY) / 2 - 6;
      path = `M ${startX} ${startY} C ${laneX} ${startY}, ${laneX} ${endY}, ${endX} ${endY}`;
      route = 'self';
      label = prefixStateMachineEdgeLabel(label, '↻');
      routeMaxRight = Math.max(routeMaxRight, laneX + 110);
    } else if (forward) {
      startX = from.x + fromSize.width;
      startY = from.y + fromSize.height / 2;
      endX = to.x;
      endY = to.y + toSize.height / 2;
      const middleX = (startX + endX) / 2;
      labelX = (startX + endX) / 2;
      labelY = Math.min(startY, endY) - 30;
      path = `M ${startX} ${startY} C ${middleX} ${startY}, ${middleX} ${endY}, ${endX} ${endY}`;
      route = 'forward';
    } else {
      startX = from.x + fromSize.width / 2;
      startY = from.y;
      endX = to.x + toSize.width / 2;
      endY = to.y;
      const lane = returnLanes.get(edge) || 0;
      const laneY = stateTop - 62 - lane * returnLaneGap;
      const direction = endX < startX ? -1 : 1;
      const corner = 12;
      labelX = (startX + endX) / 2;
      labelY = laneY - 24;
      path = [
        `M ${startX} ${startY}`,
        `L ${startX} ${laneY + corner}`,
        `Q ${startX} ${laneY} ${startX + direction * corner} ${laneY}`,
        `L ${endX - direction * corner} ${laneY}`,
        `Q ${endX} ${laneY} ${endX} ${laneY + corner}`,
        `L ${endX} ${endY}`
      ].join(' ');
      route = 'return';
      label = prefixStateMachineEdgeLabel(label, '↩');
    }
    edges.push({
      ...edge,
      route,
      label,
      startX,
      startY,
      endX,
      endY,
      labelX,
      labelY,
      minX: Math.min(startX, endX),
      maxX: Math.max(startX, endX),
      path
    });
  });

  return {
    nodes: displayNodes,
    positions,
    sizes,
    edges,
    width: Math.max(980, routeMaxRight + margin),
    height: Math.max(680, maxBottom + margin)
  };
}

function prefixStateMachineEdgeLabel(label, prefix) {
  const lines = String(label || '').split('\n');
  lines[0] = `${prefix} ${lines[0] || '转换'}`;
  return lines.join('\n');
}

function getStateParentDepth(node, graph) {
  let depth = 0;
  let parent = String(node?.value?.parent || '').trim();
  const visited = new Set();
  while (parent && !visited.has(parent)) {
    visited.add(parent);
    const parentNode = graph.nodes.find((candidate) => (
      String(candidate.value?.name || candidate.id) === parent
    ));
    if (!parentNode) {
      break;
    }
    depth += 1;
    parent = String(parentNode.value?.parent || '').trim();
  }
  return depth;
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
  if (raw === 'free' || raw === 'movable' || raw === 'blueprint' || raw === 'grid') {
    return 'free';
  }
  return 'fixed';
}

function getGraphAlgorithm() {
  return String(state.domain?.graph?.algorithm || '').trim().toLowerCase();
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
  const anchor = scale > fitScale + 0.001 ? getGraphResetAnchor() : null;
  state.view.tx = anchor
    ? Math.round(viewport.width * 0.28 - anchor.x * scale)
    : Math.round((viewport.width - contentWidth * scale) / 2);
  state.view.ty = FIT_VIEW_PADDING;
}

function getGraphResetAnchor() {
  if (isFreeGraph() || isBlueprintGraph()) {
    return null;
  }

  const item = graphNodes.querySelector('.graph-node:not(.graph-node--pseudo)');
  if (!item) {
    return null;
  }

  const x = parseFloat(item.style.left || '0') + (item.offsetWidth || GRAPH_NODE_WIDTH) / 2;
  const y = parseFloat(item.style.top || '0');
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
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
