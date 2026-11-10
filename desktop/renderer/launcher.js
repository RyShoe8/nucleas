const api = window.nucleasDesktop;
const $ = id => document.getElementById(id);
let current, lastGrid;
const icons = { team:'◈', work:'▤', growth:'↗', settings:'⚙', today:'◷', companies:'▦', assistant:'✦', building:'⌘', mail:'✉', jobs:'≡', marketing:'↗', content:'✎', tools:'◇', agenda:'▤', 'ai-spend':'$', 'ai-budgets':'◎', 'ai-routing':'⌁', voice:'◉', tasks:'✓' };
async function open(id) { try { await api.openModule(id); $('error').hidden = true; } catch { $('error').textContent = 'Could not open this app. Try again.'; $('error').hidden = false; } }
function render(state) {
  current = state;
  document.body.classList.toggle('compact', state.compact);
  $('compact').textContent = state.compact ? '+' : '−';
  $('compact').setAttribute('aria-label', state.compact ? 'Expand launcher' : 'Collapse launcher');
  $('status').textContent = state.update.text;
  const query = $('search').value.toLowerCase();
  const gridKey = JSON.stringify([query, state.apps, state.windows.map(w => w.key)]);
  if (gridKey === lastGrid) return;
  lastGrid = gridKey;
  const order = ['companies', 'team', 'work', 'today', 'mail', 'agenda', 'settings'];
  const apps = [...state.apps].sort((a,b) => order.indexOf(a.id) - order.indexOf(b.id)).filter(app => app.id !== 'assistant' && app.title.toLowerCase().includes(query));
  $('count').textContent = 'COMPANIES → TEAM → WORK';
  $('empty').hidden = apps.length !== 0;
  $('apps').replaceChildren(...apps.map((app, i) => {
    const button = document.createElement('button'); button.className = 'app'; button.setAttribute('role', 'listitem');
    button.title = app.permission === 'admin' ? `${app.title} · admin access` : app.title;
    const glyph = document.createElement('span'); glyph.className = 'glyph'; glyph.style.setProperty('--hue', String(210 + (i * 31) % 145)); glyph.textContent = icons[app.id] || '◇'; glyph.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span'); label.className = 'label'; label.textContent = app.title;
    const detail = document.createElement('small'); detail.className = 'app-description'; detail.textContent = ({ companies: 'Performance & context', team: 'Delegate & guide', work: 'Decisions & results', today: 'Portfolio briefing', mail: 'Conversations', agenda: 'Your schedule', settings: 'Engine & connections' })[app.id] || '';
    button.append(glyph, label, detail);
    if (state.windows.some(w => w.key.startsWith(`${app.id}:`))) { const dot = document.createElement('span'); dot.className = 'running'; button.append(dot); }
    button.onclick = () => open(app.id); return button;
  }));
}
$('ask').onclick = () => open('assistant');
$('search').oninput = () => { if (current) render(current); };
$('search').onkeydown = event => { if (event.key === 'Enter') $('apps').querySelector('button')?.click(); };
$('compact').onclick = () => api.compact(!current?.compact);
$('hide').onclick = () => api.hide();
$('update').onclick = () => current?.update.phase === 'ready' ? api.installUpdate() : api.update();
document.addEventListener('keydown', event => { if (event.key === 'Escape') api.hide(); });
api.onState(render);
api.state().then(render);
