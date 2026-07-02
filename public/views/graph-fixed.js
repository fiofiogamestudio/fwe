(function registerGraphFixedView() {
  window.fwe.registerView('graph-fixed', {
    test: (view, domain) => (view?.type === 'graph' || domain?.kind === 'graph') && domain?.graph?.layout !== 'free' ? 100 : 0,
    validateView(view) {
      const issues = view?.target ? [] : ['graph view needs a target.'];
      if (view?.layout === 'free') {
        issues.push('graph-fixed cannot render a free-layout graph view.');
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
