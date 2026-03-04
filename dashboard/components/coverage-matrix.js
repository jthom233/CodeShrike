// Coverage Matrix component — renders the scope coverage matrix view
// Layer order and colors must match CSS variable definitions in styles.css

const LAYERS = [
  { id: 'ui',          label: 'UI',    color: 'var(--layer-ui)'          },
  { id: 'api',         label: 'API',   color: 'var(--layer-api)'         },
  { id: 'logic',       label: 'Logic', color: 'var(--layer-logic)'       },
  { id: 'data',        label: 'Data',  color: 'var(--layer-data)'        },
  { id: 'filesystem',  label: 'FS',    color: 'var(--layer-filesystem)'  },
  { id: 'auth',        label: 'Auth',  color: 'var(--layer-auth)'        },
  { id: 'integration', label: 'Integ', color: 'var(--layer-integration)' },
  { id: 'performance', label: 'Perf',  color: 'var(--layer-performance)' },
];

const HEALTH_CONFIG = {
  OK:      { cls: 'health-ok',      label: 'OK'      },
  GAP:     { cls: 'health-gap',     label: 'GAP'     },
  SHALLOW: { cls: 'health-shallow', label: 'SHALLOW' },
  EMPTY:   { cls: 'health-empty',   label: 'EMPTY'   },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function listAnd(arr) {
  if (!arr || arr.length === 0) return 'none';
  if (arr.length === 1) return arr[0];
  return arr.slice(0, -1).join(', ') + ' and ' + arr[arr.length - 1];
}

// ── Row rendering ─────────────────────────────────────────────────────────────

function renderRow(suite, index, layers) {
  const counts = suite.layers ?? {};
  const intended = new Set(suite.intended ?? []);
  const coveredCount = layers.filter(l => (counts[l.id] ?? 0) > 0).length;
  const health = suite.health ?? 'EMPTY';
  const { cls = 'health-empty', label = health } = HEALTH_CONFIG[health] ?? {};

  const cells = layers.map(layer => {
    const count = counts[layer.id] ?? 0;
    const isGap = intended.has(layer.id) && count === 0;

    let cellClass;
    let display;
    if (isGap) {
      cellClass = 'cm-td-gap';
      display = '&ndash;';
    } else if (count > 0) {
      cellClass = 'cm-td-nonzero';
      display = String(count);
    } else {
      cellClass = 'cm-td-zero';
      display = '&ndash;';
    }

    return `<td class="${cellClass}" title="${escapeHtml(layer.label)}: ${count} step${count !== 1 ? 's' : ''}${isGap ? ' (coverage gap)' : ''}">${display}</td>`;
  }).join('');

  return `
    <tr class="cm-row suite-row" data-suite-id="${escapeHtml(suite.suite_id)}" data-index="${index}" tabindex="-1" role="row">
      <td class="cm-td-suite">
        <a href="#/suites/${escapeHtml(suite.suite_id)}" class="suite-link">${escapeHtml(suite.name)}</a>
      </td>
      ${cells}
      <td class="cm-td-depth">${coveredCount}/${layers.length}</td>
      <td class="cm-td-health"><span class="badge ${escapeHtml(cls)}">${escapeHtml(label)}</span></td>
    </tr>
  `;
}

// ── Gap analysis section ──────────────────────────────────────────────────────

function buildGapAnalysis(suites, layers) {
  const items = [];

  for (const suite of suites) {
    const counts = suite.layers ?? {};
    const intended = suite.intended ?? [];
    const health = suite.health ?? 'EMPTY';

    // GAP items: intended layers with zero steps
    const gapLayers = intended.filter(l => (counts[l] ?? 0) === 0);
    if (gapLayers.length > 0) {
      items.push({
        health: 'GAP',
        text: `<strong>${escapeHtml(suite.name)}</strong> intends to cover <strong>${listAnd(intended)}</strong> but has no steps for <strong>${listAnd(gapLayers)}</strong>`,
      });
    }

    // SHALLOW items (only flagged by health, not duplicate with GAP)
    if (health === 'SHALLOW' && gapLayers.length === 0) {
      const coveredLayers = layers.filter(l => (counts[l.id] ?? 0) > 0).map(l => l.label);
      items.push({
        health: 'SHALLOW',
        text: `<strong>${escapeHtml(suite.name)}</strong> only covers ${coveredLayers.length} of ${layers.length} layers (${listAnd(coveredLayers)})`,
      });
    }

    // EMPTY suites
    if (health === 'EMPTY') {
      items.push({
        health: 'EMPTY',
        text: `<strong>${escapeHtml(suite.name)}</strong> has no test steps in any layer`,
      });
    }
  }

  if (items.length === 0) return '';

  const rows = items.map(item => {
    const { cls = 'health-empty' } = HEALTH_CONFIG[item.health] ?? {};
    return `
      <li class="cm-gap-item">
        <span class="cm-gap-dot badge ${escapeHtml(cls)}">${escapeHtml(item.health)}</span>
        <span class="cm-gap-text">${item.text}</span>
      </li>
    `;
  }).join('');

  return `
    <section class="cm-gap-section">
      <h2 class="cm-gap-heading">Gap Analysis</h2>
      <ul class="cm-gap-list">${rows}</ul>
    </section>
  `;
}

// ── Full view render ──────────────────────────────────────────────────────────

function renderView(container, data) {
  const layers = LAYERS; // Use our canonical ordered layer list
  const suites = data.suites ?? [];
  const totalSuites = suites.length;

  // Rotated column headers for layer names
  const layerHeaders = layers.map(l =>
    `<th class="cm-th-layer" scope="col" title="${escapeHtml(l.label)}">
       <span class="cm-th-rotate" style="color: ${l.color}">${escapeHtml(l.label)}</span>
     </th>`
  ).join('');

  const bodyRows = suites.length === 0
    ? `<tr><td colspan="${layers.length + 3}" class="loading-row">No suites found.</td></tr>`
    : suites.map((s, i) => renderRow(s, i, layers)).join('');

  const gapSection = buildGapAnalysis(suites, layers);

  container.innerHTML = `
    <div class="cm-header">
      <span class="suite-count">${totalSuites} suite${totalSuites !== 1 ? 's' : ''}</span>
    </div>
    <div class="cm-scroll">
      <table class="cm-table suite-table" role="grid" aria-label="Scope coverage matrix">
        <thead>
          <tr>
            <th class="cm-th-suite" scope="col">Suite</th>
            ${layerHeaders}
            <th class="cm-th-meta" scope="col"><span class="cm-th-rotate cm-th-rotate--meta">DEPTH</span></th>
            <th class="cm-th-health-col" scope="col">HEALTH</th>
          </tr>
        </thead>
        <tbody id="cm-tbody">
          ${bodyRows}
        </tbody>
      </table>
    </div>
    ${gapSection}
  `;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Render the coverage matrix into `container`.
 * Returns a cleanup function that removes all event listeners.
 */
export function renderCoverageMatrix(container) {
  let suites = [];
  let selectedIndex = -1;

  // ── Show skeleton immediately ──
  container.innerHTML = `
    <div class="cm-header">
      <span class="suite-count" style="color: var(--text-dim)">Loading\u2026</span>
    </div>
    <div class="cm-scroll">
      <table class="cm-table suite-table">
        <tbody><tr><td class="loading-row">Loading coverage data\u2026</td></tr></tbody>
      </table>
    </div>
  `;

  // ── Fetch & render ──
  fetch('/api/coverage')
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      return res.json();
    })
    .then(data => {
      suites = data.suites ?? [];
      renderView(container, data);
      // No row selected initially
    })
    .catch(err => {
      container.innerHTML = `<p class="error-row">Failed to load coverage: ${escapeHtml(err.message)}</p>`;
    });

  // ── Helpers ──

  function getRows() {
    return container.querySelectorAll('.cm-row');
  }

  function highlightRow(index) {
    getRows().forEach((row, i) => {
      const selected = i === index;
      row.classList.toggle('suite-row--selected', selected);
      row.setAttribute('tabindex', selected ? '0' : '-1');
      if (selected) row.scrollIntoView({ block: 'nearest' });
    });
  }

  function openSelected() {
    if (selectedIndex >= 0 && selectedIndex < suites.length) {
      window.location.hash = `#/suites/${suites[selectedIndex].suite_id}`;
    }
  }

  // ── Event handlers ──

  function onKeydown(e) {
    // Only handle j/k/Enter when not in an input
    const active = document.activeElement;
    if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA')) return;

    const rows = getRows();
    if (rows.length === 0) return;

    if (e.key === 'j' || e.key === 'ArrowDown') {
      e.preventDefault();
      if (selectedIndex < 0) {
        selectedIndex = 0;
      } else {
        selectedIndex = Math.min(selectedIndex + 1, rows.length - 1);
      }
      highlightRow(selectedIndex);
      return;
    }

    if (e.key === 'k' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (selectedIndex < 0) {
        selectedIndex = rows.length - 1;
      } else {
        selectedIndex = Math.max(selectedIndex - 1, 0);
      }
      highlightRow(selectedIndex);
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      openSelected();
    }
  }

  function onTbodyClick(e) {
    const row = e.target.closest('.cm-row');
    if (!row) return;
    const index = parseInt(row.dataset.index, 10);
    if (!isNaN(index)) {
      selectedIndex = index;
      highlightRow(selectedIndex);
      // Navigation handled by the <a> tag inside the row
    }
  }

  document.addEventListener('keydown', onKeydown);
  container.addEventListener('click', onTbodyClick);

  // ── Cleanup ──
  return function cleanup() {
    document.removeEventListener('keydown', onKeydown);
    container.removeEventListener('click', onTbodyClick);
  };
}
