// Run Viewer — fetches GET /api/runs/:id and renders a step-by-step
// screenshot viewer with keyboard navigation.

const STATUS_COLOR = {
  pass:     'var(--pass)',
  fail:     'var(--fail)',
  skip:     'var(--skip)',
  blocked:  'var(--blocked)',
  untested: 'var(--untested)',
};

const LAYER_COLORS = {
  ui:      '#60a5fa',
  api:     '#34d399',
  auth:    '#f472b6',
  db:      '#fbbf24',
  default: '#a78bfa',
};

function layerColor(layer) {
  return LAYER_COLORS[layer] ?? LAYER_COLORS.default;
}

function layerPill(layer) {
  const color = layerColor(layer);
  return `<span class="layer-pill" style="background:${color}20;color:${color};border:1px solid ${color}60;">${escHtml(layer)}</span>`;
}

function statusBadge(status) {
  const color = STATUS_COLOR[status] ?? 'var(--text-dim)';
  return `<span class="status-badge" style="color:${color};border-color:${color}">${escHtml(status)}</span>`;
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderProgressBar(progress) {
  const { total = 0, passed = 0, failed = 0, skipped = 0, blocked = 0, untested = 0 } = progress;
  if (total === 0) return '';

  const pct = n => ((n / total) * 100).toFixed(1);

  const segments = [
    { key: 'passed',   val: passed,   color: 'var(--pass)',     label: `pass: ${passed}`     },
    { key: 'failed',   val: failed,   color: 'var(--fail)',     label: `fail: ${failed}`     },
    { key: 'skipped',  val: skipped,  color: 'var(--skip)',     label: `skip: ${skipped}`    },
    { key: 'blocked',  val: blocked,  color: 'var(--blocked)',  label: `blocked: ${blocked}` },
    { key: 'untested', val: untested, color: 'var(--untested)', label: `untested: ${untested}` },
  ].filter(s => s.val > 0);

  const bars = segments.map(s =>
    `<div class="progress-segment" style="width:${pct(s.val)}%;background:${s.color}" title="${s.label}"></div>`
  ).join('');

  const counts = [
    passed   ? `<span style="color:var(--pass)">&#10003; ${passed}</span>` : '',
    failed   ? `<span style="color:var(--fail)">&#10007; ${failed}</span>` : '',
    skipped  ? `<span style="color:var(--skip)">&#9702; ${skipped}</span>` : '',
    blocked  ? `<span style="color:var(--blocked)">&#9632; ${blocked}</span>` : '',
    untested ? `<span style="color:var(--untested)">&#9675; ${untested}</span>` : '',
  ].filter(Boolean).join(' ');

  return `
    <div class="progress-bar-container">
      <div class="progress-bar-track">${bars}</div>
      <div class="progress-counts">${counts} <span class="text-dim">/ ${total} steps</span></div>
    </div>`;
}

function renderNavigatorStrip(steps, resultsByStepId, selectedIdx) {
  const cells = steps.map((step, i) => {
    const result = resultsByStepId[step.id];
    const status = result ? result.status : 'untested';
    const color  = STATUS_COLOR[status] ?? 'var(--untested)';
    const sel    = i === selectedIdx ? 'selected' : '';
    return `<div class="nav-cell ${sel}" data-idx="${i}" style="background:${color}" title="${escHtml(step.name)} [${escHtml(status)}]"></div>`;
  }).join('');

  return `<div class="step-navigator" id="step-navigator">${cells}</div>`;
}

function renderStepDetail(step, result, container, runId) {
  if (!step) {
    container.innerHTML = '<p class="empty">No step selected.</p>';
    return;
  }

  const status   = result ? result.status   : 'untested';
  const actual   = result ? (result.actual  ?? '') : '';
  const notes    = result ? (result.notes   ?? '') : '';
  const shotPath = result ? (result.screenshot ?? '') : '';

  const screenshotHtml = shotPath
    ? `<div class="screenshot-wrapper">
         <img class="step-screenshot" id="step-screenshot"
              src="/screenshots/${escHtml(shotPath)}"
              alt="Screenshot for step ${escHtml(step.name)}"
              loading="lazy" />
       </div>`
    : `<div class="screenshot-placeholder">No screenshot</div>`;

  container.innerHTML = `
    <div class="step-detail-panel">
      <div class="step-detail-header">
        <span class="step-ordinal">#${escHtml(String(step.ordinal))}</span>
        <span class="step-name">${escHtml(step.name)}</span>
        ${layerPill(step.layer)}
        ${statusBadge(status)}
      </div>

      <dl class="step-fields">
        <dt>Expected</dt>
        <dd>${escHtml(step.expected ?? '')}</dd>

        <dt>Actual</dt>
        <dd>${actual ? escHtml(actual) : '<span class="text-dim">—</span>'}</dd>

        ${notes ? `<dt>Notes</dt><dd>${escHtml(notes)}</dd>` : ''}
      </dl>

      ${screenshotHtml}
    </div>`;

  // Keyboard: Space toggles screenshot zoom
  const img = container.querySelector('.step-screenshot');
  if (img) {
    img.addEventListener('click', () => img.classList.toggle('zoomed'));
  }
}

function renderUntestedSteps(untestedSteps) {
  if (!untestedSteps || untestedSteps.length === 0) return '';

  const items = untestedSteps.map(step =>
    `<li class="untested-step">
      ${escHtml(step.name)}
      ${layerPill(step.layer)}
    </li>`
  ).join('');

  return `
    <section class="card">
      <h3 class="card-title">Untested Steps (${untestedSteps.length})</h3>
      <ul class="untested-list">${items}</ul>
    </section>`;
}

export function renderRunViewer(container, runId) {
  container.innerHTML = '<p class="loading">Loading run&hellip;</p>';

  fetch(`/api/runs/${encodeURIComponent(runId)}`)
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(data => {
      const { run, results = [], steps = [], untested_steps = [], progress = {} } = data;

      // Index results by step_id for fast lookup
      const resultsByStepId = {};
      for (const r of results) resultsByStepId[r.step_id] = r;

      // State
      let selectedIdx = 0;
      let screenshotZoomed = false;

      function render() {
        const currentStep   = steps[selectedIdx] ?? null;
        const currentResult = currentStep ? resultsByStepId[currentStep.id] : null;

        container.innerHTML = `
          <div class="run-viewer">

            <div class="run-header">
              <div class="run-title-row">
                <h2 class="run-label">${escHtml(run.label ?? run.id)}</h2>
                <span class="run-status status-badge" style="color:${STATUS_COLOR[run.status] ?? 'var(--text-dim)'};border-color:${STATUS_COLOR[run.status] ?? 'var(--text-dim)'}">
                  ${escHtml(run.status)}
                </span>
              </div>
              ${run.started_at
                ? `<p class="run-date text-dim">${new Date(run.started_at).toLocaleString()}</p>`
                : ''}
            </div>

            ${renderProgressBar(progress)}
            ${renderNavigatorStrip(steps, resultsByStepId, selectedIdx)}

            <div id="step-detail-container"></div>

            ${renderUntestedSteps(untested_steps)}

          </div>`;

        // Render step detail into its container
        renderStepDetail(
          currentStep,
          currentResult,
          container.querySelector('#step-detail-container'),
          runId
        );

        // Wire nav cell clicks
        container.querySelectorAll('.nav-cell').forEach(cell => {
          cell.addEventListener('click', () => {
            selectedIdx = parseInt(cell.dataset.idx, 10);
            screenshotZoomed = false;
            render();
            focusNavigator();
          });
        });

        // Restore screenshot zoom state
        const img = container.querySelector('.step-screenshot');
        if (img && screenshotZoomed) img.classList.add('zoomed');
        if (img) {
          img.addEventListener('click', () => {
            screenshotZoomed = img.classList.contains('zoomed');
          });
        }

        focusNavigator();
      }

      function focusNavigator() {
        // Scroll selected cell into view
        const strip = container.querySelector('#step-navigator');
        const sel   = strip && strip.querySelector('.nav-cell.selected');
        if (sel) sel.scrollIntoView({ inline: 'nearest', behavior: 'smooth' });
      }

      // Keyboard navigation (attached once on container)
      function onKeyDown(e) {
        if (!container.contains(document.activeElement) && document.activeElement !== document.body) return;

        if (e.key === 'ArrowRight' && selectedIdx < steps.length - 1) {
          e.preventDefault();
          selectedIdx++;
          screenshotZoomed = false;
          render();
        } else if (e.key === 'ArrowLeft' && selectedIdx > 0) {
          e.preventDefault();
          selectedIdx--;
          screenshotZoomed = false;
          render();
        } else if (e.key === ' ') {
          e.preventDefault();
          const img = container.querySelector('.step-screenshot');
          if (img) {
            img.classList.toggle('zoomed');
            screenshotZoomed = img.classList.contains('zoomed');
          }
        }
      }

      // Remove previous listener if view is re-rendered
      container._runViewerKeydown && document.removeEventListener('keydown', container._runViewerKeydown);
      container._runViewerKeydown = onKeyDown;
      document.addEventListener('keydown', onKeyDown);

      render();
    })
    .catch(err => {
      container.innerHTML = `<p class="error">Failed to load run: ${escHtml(err.message)}</p>`;
    });
}
