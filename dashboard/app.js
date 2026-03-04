// CodeShrike Dashboard SPA — hash-based router
import { renderSuiteList }   from './components/suite-list.js';
import { renderSuiteDetail } from './components/suite-detail.js';
import { renderRunViewer }      from './components/run-viewer.js';
import { renderCoverageMatrix } from './components/coverage-matrix.js';

const main = document.getElementById('main');
const nav  = document.getElementById('nav');

// Active cleanup function returned by the current view component
let currentCleanup = null;

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const ROUTES = [
  { pattern: /^\/suites\/(.+)$/, view: 'suite-detail'  },
  { pattern: /^\/suites$/,       view: 'suites'         },
  { pattern: /^\/runs\/(.+)$/,   view: 'run-detail'     },
  { pattern: /^\/coverage$/,     view: 'coverage'       },
  { pattern: /^\/$/,             view: 'suites'         },
  { pattern: /^$/,               view: 'suites'         },
];

function parsePath() {
  // Hash format: #/view or #/view/id  (fall back to '/' if no hash)
  const hash = window.location.hash.replace(/^#/, '') || '/';
  for (const route of ROUTES) {
    const m = hash.match(route.pattern);
    if (m) return { view: route.view, param: m[1] || null };
  }
  return { view: 'suites', param: null };
}

function setActiveNav(view) {
  const navView = view === 'suite-detail' ? 'suites' : view;
  nav.querySelectorAll('button').forEach(b =>
    b.classList.toggle('active', b.dataset.view === navView)
  );
}

async function loadRoute() {
  // Tear down previous view
  if (currentCleanup) {
    currentCleanup();
    currentCleanup = null;
  }

  const { view, param } = parsePath();
  setActiveNav(view);
  main.innerHTML = '<p style="color: var(--text-dim)">Loading...</p>';

  try {
    if (view === 'suites') {
      currentCleanup = renderSuiteList(main);

    } else if (view === 'suite-detail' && param) {
      main.innerHTML = `<div style="padding-bottom:1rem"><a href="#/suites" class="back-link">&larr; Back to Suites</a></div><div id="suite-detail-mount"></div>`;
      renderSuiteDetail(main.querySelector('#suite-detail-mount'), param);

    } else if (view === 'coverage') {
      main.innerHTML = '';
      currentCleanup = renderCoverageMatrix(main);

    } else if (view === 'run-detail' && param) {
      main.innerHTML = `<div style="padding-bottom:1rem"><a href="#/suites" class="back-link">&larr; Back to Suites</a></div><div id="run-viewer-mount"></div>`;
      const mount = main.querySelector('#run-viewer-mount');
      renderRunViewer(mount, param);
      // Cleanup: remove keyboard listener attached to container by run-viewer
      currentCleanup = () => {
        if (mount._runViewerKeydown) {
          document.removeEventListener('keydown', mount._runViewerKeydown);
        }
      };

    } else {
      main.innerHTML = `<p style="color: var(--text-dim)">View not found.</p>`;
    }
  } catch (err) {
    main.innerHTML = `<p style="color: var(--fail)">Error: ${escapeHtml(err.message)}</p>`;
  }
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Nav click — update hash, router responds to hashchange
// ---------------------------------------------------------------------------

nav.addEventListener('click', e => {
  const view = e.target.dataset.view;
  if (!view) return;
  const hashMap = { suites: '#/suites', coverage: '#/coverage' };
  if (hashMap[view]) {
    window.location.hash = hashMap[view];
  }
});

// ---------------------------------------------------------------------------
// Keyboard shortcut: ? shows overlay
// ---------------------------------------------------------------------------

document.addEventListener('keydown', e => {
  if (e.key === '?' && document.activeElement?.tagName !== 'INPUT') {
    toggleShortcutsOverlay();
  }
});

function toggleShortcutsOverlay() {
  const existing = document.getElementById('shortcuts-overlay');
  if (existing) { existing.remove(); return; }

  const overlay = document.createElement('div');
  overlay.id = 'shortcuts-overlay';
  overlay.className = 'shortcuts-overlay';
  overlay.innerHTML = `
    <div class="shortcuts-box">
      <h3>Keyboard Shortcuts</h3>
      <table class="shortcuts-table">
        <tr><td><kbd>j</kbd> / <kbd>k</kbd></td><td>Move selection down / up</td></tr>
        <tr><td><kbd>Enter</kbd></td><td>Open selected suite</td></tr>
        <tr><td><kbd>/</kbd></td><td>Focus filter input</td></tr>
        <tr><td><kbd>Esc</kbd></td><td>Clear filter / dismiss</td></tr>
        <tr><td><kbd>?</kbd></td><td>Toggle this overlay</td></tr>
      </table>
      <p class="shortcuts-dismiss">Press <kbd>Esc</kbd> or <kbd>?</kbd> to close</p>
    </div>
  `;
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}

// ---------------------------------------------------------------------------
// Bootstrap
// ---------------------------------------------------------------------------

window.addEventListener('hashchange', loadRoute);
loadRoute();
