// ==========================================================
// CHART TOOLBAR — shared fullscreen + zoom toolbar helper
// ==========================================================

const _toolbarRegistry = new Map(); // wrapEl → { svgEl, chartObj, reinit, hasOverlayPanel }
let _fullscreenListenerAttached = false;
let _reparentedEls = []; // { el, parent, next, fsClass }

const _OVERLAY_ITEMS = [
  { sel: ".controls",       fsClass: "is-fullscreen-controls" },
  { sel: "#game-card",      fsClass: "is-fullscreen-card"     },
  { sel: "#selection-tray", fsClass: "is-fullscreen-tray"     },
];

const _ICON_EXPAND = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="6,2 2,2 2,6"/>
  <polyline points="10,2 14,2 14,6"/>
  <polyline points="6,14 2,14 2,10"/>
  <polyline points="10,14 14,14 14,10"/>
</svg>`;

const _ICON_COMPRESS = `<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <polyline points="2,6 6,6 6,2"/>
  <polyline points="14,6 10,6 10,2"/>
  <polyline points="2,10 6,10 6,14"/>
  <polyline points="14,10 10,10 10,14"/>
</svg>`;

function setupChartToolbar({ wrapEl, svgEl, chartObj, reinit, hasOverlayPanel = false }) {
  // Remove any existing toolbar (idempotent — safe to call on reinit)
  const existing = wrapEl.querySelector(".chart-toolbar");
  if (existing) existing.remove();

  const toolbar = document.createElement("div");
  toolbar.className = "chart-toolbar";
  toolbar.innerHTML = `
    <button class="ct-btn ct-fullscreen" title="Fullscreen">${_ICON_EXPAND}</button>
    <button class="ct-btn ct-zoom-in" title="Zoom in">＋</button>
    <button class="ct-btn ct-zoom-out" title="Zoom out">－</button>
  `;
  wrapEl.appendChild(toolbar);

  _toolbarRegistry.set(wrapEl, { svgEl, chartObj, reinit, hasOverlayPanel });

  toolbar.querySelector(".ct-zoom-in").addEventListener("click", (e) => {
    e.stopPropagation();
    if (!chartObj.zoom) return;
    d3.select(svgEl).transition().duration(200).call(chartObj.zoom.scaleBy, 1.4);
  });

  toolbar.querySelector(".ct-zoom-out").addEventListener("click", (e) => {
    e.stopPropagation();
    if (!chartObj.zoom) return;
    d3.select(svgEl).transition().duration(200).call(chartObj.zoom.scaleBy, 1 / 1.4);
  });

  toolbar.querySelector(".ct-fullscreen").addEventListener("click", (e) => {
    e.stopPropagation();
    if (document.fullscreenElement === wrapEl) {
      document.exitFullscreen();
    } else {
      wrapEl.requestFullscreen();
    }
  });

  if (!_fullscreenListenerAttached) {
    _fullscreenListenerAttached = true;
    document.addEventListener("fullscreenchange", _onFullscreenChange);
  }
}

function _onFullscreenChange() {
  const fsEl = document.fullscreenElement;

  for (const [wrapEl, opts] of _toolbarRegistry) {
    const wasFullscreen = wrapEl.classList.contains("is-fullscreen");
    const isFullscreen = fsEl === wrapEl;

    if (wasFullscreen === isFullscreen) continue;

    wrapEl.classList.toggle("is-fullscreen", isFullscreen);

    // Update the fullscreen button icon
    const btn = wrapEl.querySelector(".ct-fullscreen");
    if (btn) {
      btn.innerHTML = isFullscreen ? _ICON_COMPRESS : _ICON_EXPAND;
      btn.title = isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen";
    }

    // Re-parent overlay elements (filters, game card, selection tray) — landscape only
    if (opts.hasOverlayPanel) {
      if (isFullscreen) {
        _reparentedEls = [];
        for (const { sel, fsClass } of _OVERLAY_ITEMS) {
          const el = document.querySelector(sel);
          if (!el) continue;
          _reparentedEls.push({ el, parent: el.parentNode, next: el.nextSibling, fsClass });
          wrapEl.appendChild(el);
          el.classList.add(fsClass);
        }
      } else {
        for (const { el, parent, next, fsClass } of _reparentedEls) {
          parent.insertBefore(el, next);
          el.classList.remove(fsClass);
        }
        _reparentedEls = [];
      }
    }

    // Reinit the chart so it recomputes dimensions for the new size
    requestAnimationFrame(() => requestAnimationFrame(() => {
      opts.reinit();
    }));
  }
}
