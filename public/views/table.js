(function registerTableView() {
  window.fwe.registerView('table', {
    test: (view, domain) => view?.type === 'table' || domain?.kind === 'table' ? 100 : 0,
    validateView(view) {
      return view?.target ? [] : ['table view needs a target.'];
    },
    render(ctx) {
      ctx.renderInspector();
      ctx.showView('table');
      ctx.renderTable();
    }
  });
}());
