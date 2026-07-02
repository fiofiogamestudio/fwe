(function registerDiceCrossLayout() {
  if (!window.fwe) {
    return;
  }

  function ensureStyle() {
    if (document.querySelector('#diceCrossLayoutStyle')) {
      return;
    }
    const style = document.createElement('style');
    style.id = 'diceCrossLayoutStyle';
    style.textContent = `
      .dice-cross-view {
        min-height: 100%;
        display: grid;
        place-items: center;
        padding: 32px;
        background: #f7f9fc;
      }
      .dice-cross-board {
        display: grid;
        grid-template-columns: 86px 86px 86px;
        grid-template-rows: 86px 86px 86px;
        gap: 14px;
        align-items: center;
        justify-items: center;
      }
      .dice-cross-cell {
        width: 72px;
        height: 72px;
        border: 2px solid #355c8a;
        background: #fff;
        color: #243447;
        font: 700 24px/1 system-ui, sans-serif;
        cursor: pointer;
      }
      .dice-cross-cell.is-selected {
        outline: 4px solid rgba(53, 92, 138, 0.22);
      }
      .dice-cross-cell.is-locked {
        background: #f6d7d7;
      }
      .dice-cross-empty {
        color: #6b7788;
        font: 13px/1.4 system-ui, sans-serif;
      }
    `;
    document.head.append(style);
  }

  const DEFAULT_SLOTS = ['top', 'left', 'center', 'right', 'bottom'];

  function slotGridArea(slot) {
    return {
      top: '1 / 2',
      left: '2 / 1',
      center: '2 / 2',
      right: '2 / 3',
      bottom: '3 / 2'
    }[slot] || '2 / 2';
  }

  function configuredSlots(view) {
    const slots = Array.isArray(view.slots) && view.slots.length
      ? view.slots
      : DEFAULT_SLOTS;
    return slots.map((slot) => String(slot || '').trim()).filter(Boolean);
  }

  window.fwe.registerWorkbenchLayout('dice-cross', {
    validateLayout(layout) {
      const view = layout.view || {};
      const issues = [];
      if (!layout.collections.length) {
        issues.push('dice-cross 布局需要一个集合。');
      }
      if (!view.slot && !view.slotPath) {
        issues.push('dice-cross 布局需要 slot 字段。');
      }
      if (!view.face && !view.facePath) {
        issues.push('dice-cross 布局需要 face 字段。');
      }
      if (view.slots && (!Array.isArray(view.slots) || !view.slots.length)) {
        issues.push('dice-cross slots 必须是非空数组。');
      }
      return issues;
    },
    render(ctx, layout, workbench) {
      ensureStyle();
      ctx.showView('document');

      const view = layout.view || {};
      const collection = workbench.collection || layout.collections[0] || {};
      const collectionPath = collection.path || view.collection || view.target || 'dice';
      const slotPath = view.slot || view.slotPath || 'slot';
      const facePath = view.face || view.facePath || 'face';
      const lockedPath = view.locked || view.lockedPath || 'locked';
      const slots = configuredSlots(view);
      const dice = ctx.getArray(collectionPath);

      const root = document.createElement('div');
      root.className = 'dice-cross-view';
      const board = document.createElement('div');
      board.className = 'dice-cross-board';
      root.append(board);

      slots.forEach((slot) => {
        const index = dice.findIndex((item) => String(ctx.getByPath(item, slotPath)) === slot);
        if (index < 0) {
          const empty = document.createElement('div');
          empty.className = 'dice-cross-empty';
          empty.style.gridArea = slotGridArea(slot);
          empty.textContent = slot;
          board.append(empty);
          return;
        }

        const die = dice[index];
        const path = `${collectionPath}[${index}]`;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'dice-cross-cell';
        button.classList.toggle('is-selected', ctx.selection.key === path);
        button.classList.toggle('is-locked', !!ctx.getByPath(die, lockedPath));
        button.style.gridArea = slotGridArea(slot);
        button.textContent = String(ctx.getByPath(die, facePath) || 1);
        button.title = `${slot}: 单击选择，双击轮换点数`;
        button.addEventListener('click', () => ctx.selectPath(path));
        button.addEventListener('dblclick', () => {
          ctx.pushHistory(`轮换 ${slot} 骰子`);
          const current = Number(ctx.getByPath(die, facePath)) || 1;
          ctx.setByPath(die, facePath, current >= 6 ? 1 : current + 1);
          ctx.markDirty(`已轮换 ${slot} 骰子`);
        });
        board.append(button);
      });

      ctx.hosts.documentTree.innerHTML = '';
      ctx.hosts.documentTree.append(root);
    }
  });
}());
