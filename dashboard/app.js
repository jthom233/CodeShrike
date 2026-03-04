// CodeShrike Dashboard SPA
const main = document.getElementById('main');
const nav = document.getElementById('nav');

async function loadView(view) {
  nav.querySelectorAll('button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  main.innerHTML = '<p style="color: var(--text-dim)">Loading...</p>';

  try {
    if (view === 'suites') {
      const res = await fetch('/api/suites');
      const data = await res.json();
      main.innerHTML = `<pre>${JSON.stringify(data, null, 2)}</pre>`;
    } else if (view === 'coverage') {
      const res = await fetch('/api/coverage');
      const data = await res.json();
      main.innerHTML = `<pre>${JSON.stringify(data, null, 2)}</pre>`;
    }
  } catch (err) {
    main.innerHTML = `<p style="color: var(--fail)">Error: ${err.message}</p>`;
  }
}

nav.addEventListener('click', e => {
  if (e.target.dataset.view) loadView(e.target.dataset.view);
});

loadView('suites');
