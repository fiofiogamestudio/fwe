(function registerGraphFreeView() {
  window.fwe.registerView('graph-free', {
    test: (view, domain) => (view?.type === 'graph' || domain?.kind === 'graph') && domain?.graph?.layout === 'free' ? 100 : 0,
    validateView(view) {
      const issues = view?.target ? [] : ['graph view needs a target.'];
      if (view?.layout && view.layout !== 'free') {
        issues.push('graph-free needs layout free.');
      }
      return issues;
    },
    render(ctx) {
      ctx.renderInspector();
      ctx.showView('graph');
      ctx.renderGraph();
    }
  });
}());
