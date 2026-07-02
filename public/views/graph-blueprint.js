(function registerGraphBlueprintView() {
  window.fwe.registerView('graph-blueprint', {
    test: (view, domain) => (view?.type === 'blueprint' || domain?.graph?.blueprint) ? 120 : 0,
    validateView(view, domain) {
      const issues = [];
      const blueprint = domain?.graph?.blueprint;
      if (!blueprint) {
        issues.push('graph-blueprint needs graph.blueprint.');
      }
      if (!view?.target && !blueprint?.nodes) {
        issues.push('graph-blueprint needs a node target.');
      }
      if (!blueprint?.edges) {
        issues.push('graph-blueprint needs an edge collection.');
      }
      if (!blueprint?.types?.length) {
        issues.push('graph-blueprint needs node type templates.');
      }
      return issues;
    },
    render(ctx) {
      ctx.renderInspector();
      ctx.showView('graph');
      ctx.renderBlueprintGraph(ctx.view);
    }
  });
}());
