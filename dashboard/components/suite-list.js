// Suite Library component — renders the suite list view
// Layer order and colors must match CSS variable definitions in styles.css

const LAYERS = [
  { id: 'ui',          label: 'UI',          color: 'var(--layer-ui)'          },
  { id: 'api',         label: 'API',         color: 'var(--layer-api)'         },
  { id: 'logic',       label: 'Logic',       color: 'var(--layer-logic)'       },
  { id: 'data',        label: 'Data',        color: 'var(--layer-data)'        },
  { id: 'filesystem',  label: 'FS',          color: 'var(--layer-filesystem)'  },
  { id: 'auth',        label: 'Auth',        color: 'var(--layer-auth)'        },
  { id: 'integration', label: 'Integ',       color: 'var(--layer-integration)' },
  { id: 'performance', label: 'Perf',        color: 'var(--layer-performance)' },
];

/**
 * Derive a health badge value from a suite.
 * EMPTY  — no steps at all
 * SHALLOW — has steps but only 1–2 layers
 * GAP    — suite declares layers it has no steps in
 *          (we approximate: if step_count > 0 but layers list is sparse vs. steps)
 * OK     — all declared layers have steps and depth >= 3
 */
function healthBadge(suite) {
  if (!suite.step_count || suite.step_count === 0) return 'EMPTY';
  const layerCount = (suite.layers || []).length;
  if (layerCount === 0) return 'EMPTY';
  if (layerCount <= 2) return 'SHALLOW';
  // GAP: declared layers but suspiciously few steps relative to layer count
  // A heuristic: fewer than (layerCount * 1) steps suggests some layers are empty
  if (suite.step_count < layerCount) return 'GAP';
  return 'OK';
}

/**
 * Derive a status badge value from latest_run.
 */
function runStatus(latest_run) {
  if (!latest_run) return 'NO RUNS';
  const s = latest_run.status;
  if (s === 'running') return 'RUNNING';
  if (s === 'completed') {
    const { failed = 0, blocked = 0 } = latest_run.summary || {};
    return (failed > 0 || blocked > 0) ? 'FAIL' : 'PASS';
  }
  return s.toUpperCase();
}

/**
 * Render a row of 8 layer-dot squares.
 * Filled squares use the layer's color variable; empty squares are dim.
 */
function renderLayerDots(suiteLayerSet) {
  return LAYERS.map(layer => {
    const active = suiteLayerSet.has(layer.id);
    return `<span
      class="layer-dot${active ? ' layer-dot--active' : ''}"
      style="${active ? `background: ${layer.color}; border-color: ${layer.color};` : ''}"
      title="${layer.label}"
    ></span>`;
  }).join('');
}

/**
 * Render a single suite row.
 */
function renderRow(suite, index) {
  const layerSet = new Set(suite.layers || []);
  const health = healthBadge(suite);
  const status = runStatus(suite.latest_run);

  const statusClass = {
    'PASS':    'status-pass',
    'FAIL':    'status-fail',
    'RUNNING': 'status-running',
    'NO RUNS': 'status-untested',
  }[status] || 'status-untested';

  const healthClass = {
    'OK':      'health-ok',
    'SHALLOW': 'health-shallow',
    'GAP':     'health-gap',
    'EMPTY':   'health-empty',
  }[health] || '';

  return `
    <tr class="suite-row" data-suite-id="${suite.id}" data-index="${index}" tabindex="-1">
      <td class="suite-name">
        <a href="#/suites/${suite.id}" class="suite-link">${escapeHtml(suite.name)}</a>
      </td>
      <td>
        <div class="layer-dots">${renderLayerDots(layerSet)}</div>
      </td>
      <td class="suite-steps">${suite.step_count ?? 0}</td>
      <td><span class="badge ${statusClass}">${status}</span></td>
      <td><span class="badge ${healthClass}">${health}</span></td>
    </tr>
  `;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Render the full suite list into `container`.
 * Returns a cleanup function that removes all event listeners.
 */
export function renderSuiteList(container) {
  let allSuites = [];
  let selectedIndex = -1;
  let filterValue = '';

  // --- Build skeleton immediately so there's no empty-screen flash ---
  container.innerHTML = `
    <div class="suite-list-header">
      <input
        class="filter-input"
        type="text"
        placeholder="/ filter suites..."
        aria-label="Filter suites"
        id="suite-filter"
      />
      <span class="suite-count" id="suite-count"></span>
    </div>
    <div class="suite-table-wrap">
      <table class="suite-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Layers</th>
            <th>Steps</th>
            <th>Last Run</th>
            <th>Health</th>
          </tr>
        </thead>
        <tbody id="suite-tbody">
          <tr><td colspan="5" class="loading-row">Loading...</td></tr>
        </tbody>
      </table>
    </div>
  `;

  const filterInput = container.querySelector('#suite-filter');
  const countEl     = container.querySelector('#suite-count');
  const tbody       = container.querySelector('#suite-tbody');

  // --- Rendering helpers ---

  function getVisible() {
    const q = filterValue.toLowerCase();
    if (!q) return allSuites;
    return allSuites.filter(s => s.name.toLowerCase().includes(q) || s.id.toLowerCase().includes(q));
  }

  function renderTable() {
    const visible = getVisible();
    countEl.textContent = `${visible.length} / ${allSuites.length} suites`;

    if (visible.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="empty-row">No suites match "${escapeHtml(filterValue)}"</td></tr>`;
      selectedIndex = -1;
      return;
    }

    tbody.innerHTML = visible.map((s, i) => renderRow(s, i)).join('');

    // Re-apply selection highlight
    if (selectedIndex >= 0) {
      const clampedIndex = Math.min(selectedIndex, visible.length - 1);
      selectedIndex = clampedIndex;
      highlightRow(clampedIndex);
    }
  }

  function highlightRow(index) {
    tbody.querySelectorAll('.suite-row').forEach((row, i) => {
      row.classList.toggle('suite-row--selected', i === index);
    });
    // Scroll into view if needed
    const targetRow = tbody.querySelector(`.suite-row[data-index="${index}"]`);
    targetRow?.scrollIntoView({ block: 'nearest' });
  }

  function openSelected() {
    const visible = getVisible();
    if (selectedIndex >= 0 && selectedIndex < visible.length) {
      const suite = visible[selectedIndex];
      window.location.hash = `#/suites/${suite.id}`;
    }
  }

  // --- Fetch data ---

  fetch('/api/suites')
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(data => {
      allSuites = data.suites || [];
      renderTable();
    })
    .catch(err => {
      tbody.innerHTML = `<tr><td colspan="5" class="error-row">Error loading suites: ${escapeHtml(err.message)}</td></tr>`;
    });

  // --- Event listeners ---

  function onFilterInput(e) {
    filterValue = e.target.value;
    selectedIndex = -1;
    renderTable();
  }

  function onTbodyClick(e) {
    const row = e.target.closest('.suite-row');
    if (!row) return;
    const index = parseInt(row.dataset.index, 10);
    selectedIndex = index;
    highlightRow(index);
    // Navigation is handled by the <a> tag inside the row
  }

  function onKeydown(e) {
    const visible = getVisible();

    // '/' focuses the filter from anywhere in the view
    if (e.key === '/' && document.activeElement !== filterInput) {
      e.preventDefault();
      filterInput.focus();
      filterInput.select();
      return;
    }

    // j / k navigation (only when filter is not focused)
    if (document.activeElement === filterInput) return;

    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, visible.length - 1);
      if (selectedIndex < 0 && visible.length > 0) selectedIndex = 0;
      highlightRow(selectedIndex);
      return;
    }

    if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      highlightRow(selectedIndex);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      openSelected();
      return;
    }

    // Escape clears the filter
    if (e.key === 'Escape' && document.activeElement === filterInput) {
      filterInput.value = '';
      filterValue = '';
      selectedIndex = -1;
      renderTable();
      filterInput.blur();
    }
  }

  filterInput.addEventListener('input', onFilterInput);
  tbody.addEventListener('click', onTbodyClick);
  document.addEventListener('keydown', onKeydown);

  // Auto-focus filter on load
  filterInput.focus();

  // --- Cleanup ---
  return function cleanup() {
    filterInput.removeEventListener('input', onFilterInput);
    tbody.removeEventListener('click', onTbodyClick);
    document.removeEventListener('keydown', onKeydown);
  };
}
