// Suite Detail view — fetches GET /api/suites/:id and renders suite info,
// scope coverage, steps table, and run history.

const LAYER_COLORS = {
  ui:       '#60a5fa',
  api:      '#34d399',
  auth:     '#f472b6',
  db:       '#fbbf24',
  default:  '#a78bfa',
};

function layerColor(layer) {
  return LAYER_COLORS[layer] ?? LAYER_COLORS.default;
}

function layerPill(layer, style = '') {
  const color = layerColor(layer);
  return `<span class="layer-pill" style="background:${color}20;color:${color};border:1px solid ${color}60;${style}">${layer}</span>`;
}

function statusBadge(status) {
  const map = {
    completed: { color: 'var(--pass)',    label: 'completed'  },
    failed:    { color: 'var(--fail)',    label: 'failed'     },
    running:   { color: 'var(--skip)',    label: 'running'    },
    pending:   { color: 'var(--text-dim)', label: 'pending'  },
  };
  const { color, label } = map[status] ?? { color: 'var(--text-dim)', label: status };
  return `<span class="status-badge" style="color:${color};border-color:${color}">${label}</span>`;
}

function formatDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function renderScopeCoverage(scope_coverage) {
  if (!scope_coverage) return '';
  const { intended = [], gaps = [] } = scope_coverage;
  const gapSet = new Set(gaps);

  const pills = intended.map(layer => {
    if (gapSet.has(layer)) {
      return `<span class="scope-pill scope-gap" title="Not covered">
        ${layerPill(layer)}
        <span class="gap-label">NOT COVERED</span>
      </span>`;
    }
    return `<span class="scope-pill">${layerPill(layer)}</span>`;
  }).join('');

  return `
    <section class="card">
      <h3 class="card-title">Scope Coverage</h3>
      <div class="scope-bar">${pills}</div>
      ${gaps.length ? `<p class="gap-warning">&#9888; ${gaps.length} layer${gaps.length > 1 ? 's' : ''} not covered: ${gaps.join(', ')}</p>` : ''}
    </section>`;
}

function renderStepsTable(steps) {
  if (!steps || steps.length === 0) {
    return `<section class="card"><h3 class="card-title">Steps</h3><p class="empty">No steps defined.</p></section>`;
  }

  const rows = steps.map(step => `
    <tr>
      <td class="ordinal">${step.ordinal}</td>
      <td>${escHtml(step.name)}</td>
      <td>${layerPill(step.layer)}</td>
      <td class="expected">${escHtml(step.expected ?? '')}</td>
    </tr>`).join('');

  return `
    <section class="card">
      <h3 class="card-title">Steps</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Name</th>
            <th>Layer</th>
            <th>Expected Outcome</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function runDelta(run, prevRun) {
  if (!prevRun || !run.summary || !prevRun.summary) return '';
  const diff = (run.summary.passed ?? 0) - (prevRun.summary.passed ?? 0);
  if (diff === 0) return '<span class="delta delta-neutral">±0</span>';
  if (diff > 0)   return `<span class="delta delta-up">&#9650;${diff}</span>`;
  return `<span class="delta delta-down">&#9660;${Math.abs(diff)}</span>`;
}

function renderRunHistory(runs) {
  if (!runs || runs.length === 0) {
    return `<section class="card"><h3 class="card-title">Run History</h3><p class="empty">No runs yet.</p></section>`;
  }

  const rows = runs.map((run, i) => {
    const prev = runs[i + 1] ?? null;
    const s = run.summary ?? {};
    const passed  = s.passed  ?? 0;
    const failed  = s.failed  ?? 0;
    const skipped = s.skipped ?? 0;
    const total   = s.total   ?? (passed + failed + skipped);

    return `
      <tr class="run-row" data-run-id="${escAttr(run.id)}" tabindex="0" title="View run ${escAttr(run.id)}">
        <td>${escHtml(run.label ?? run.id)}</td>
        <td>${statusBadge(run.status)}</td>
        <td class="date">${formatDate(run.started_at)}</td>
        <td class="counts">
          <span class="pass-count">&#10003; ${passed}</span>
          <span class="fail-count">&#10007; ${failed}</span>
          ${skipped ? `<span class="skip-count">&#9702; ${skipped}</span>` : ''}
          <span class="total-count">/ ${total}</span>
        </td>
        <td>${runDelta(run, prev)}</td>
      </tr>`;
  }).join('');

  return `
    <section class="card">
      <h3 class="card-title">Run History</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>Label</th>
            <th>Status</th>
            <th>Date</th>
            <th>Results</th>
            <th>Delta</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    </section>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escAttr(str) {
  return String(str).replace(/"/g, '&quot;');
}

export function renderSuiteDetail(container, suiteId) {
  container.innerHTML = '<p class="loading">Loading suite&hellip;</p>';

  fetch(`/api/suites/${encodeURIComponent(suiteId)}`)
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(data => {
      const { suite, steps, runs, scope_coverage } = data;

      container.innerHTML = `
        <div class="suite-detail">

          <div class="suite-header">
            <div class="suite-title-row">
              <h2 class="suite-name">${escHtml(suite.name)}</h2>
              <span class="version-badge">v${escHtml(String(suite.version ?? 1))}</span>
            </div>
            ${suite.description
              ? `<p class="suite-description">${escHtml(suite.description)}</p>`
              : ''}
            <div class="suite-layers">
              ${(suite.layers ?? []).map(l => layerPill(l)).join(' ')}
            </div>
          </div>

          ${renderScopeCoverage(scope_coverage)}
          ${renderStepsTable(steps)}
          ${renderRunHistory(runs)}

        </div>`;

      // Wire up run row click/keyboard navigation
      container.querySelectorAll('.run-row').forEach(row => {
        const navigate = () => {
          const id = row.dataset.runId;
          if (id) window.location.hash = `#/runs/${encodeURIComponent(id)}`;
        };
        row.addEventListener('click', navigate);
        row.addEventListener('keydown', e => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(); }
        });
      });
    })
    .catch(err => {
      container.innerHTML = `<p class="error">Failed to load suite: ${escHtml(err.message)}</p>`;
    });
}
