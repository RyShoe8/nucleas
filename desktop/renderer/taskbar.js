const api = window.nucleasTaskbar;
const $ = id => document.getElementById(id);
let current = { windows: [] }, initialized = false, signature = '', noticeTimer, submitting = false;
function notice(text) {
  clearTimeout(noticeTimer);
  $('notice').textContent = text; $('notice').title = text; $('notice').hidden = false;
  noticeTimer = setTimeout(() => { $('notice').hidden = true; }, 5000);
}
async function act(action) { try { await action(); } catch { notice('Could not open that window. Try again from Office.'); } }
function overflow() {
  const nav = $('windows');
  // Native popup menus escape the taskbar's clipped surface, unlike HTML dropdowns.
  $('overflow').hidden = !current.windows.length || (nav.clientWidth > 0 && nav.scrollWidth <= nav.clientWidth && !document.body.classList.contains('vertical'));
}
function render(state) {
  current = state;
  const count = state.attention?.count ?? 0;
  $('attention-count').textContent = count > 99 ? '99+' : String(count); $('attention-count').hidden = !count;
  $('attention').title = `${count ? `${count} need you · ` : ''}Notifications & email summaries`;
  document.body.classList.toggle('light', !state.dark);
  document.body.classList.toggle('vertical', state.vertical);
  if (!initialized) { $('question').value = state.draft || ''; initialized = true; }
  const next = JSON.stringify(state.windows);
  if (next !== signature) {
    signature = next;
    $('windows').replaceChildren(...state.windows.map(entry => {
      const button = document.createElement('button');
      button.className = 'window'; button.textContent = entry.title; button.title = `Restore ${entry.title}`;
      button.onclick = () => act(() => api.restore(entry.key));
      return button;
    }));
  }
  overflow();
}
$('office').onclick = () => act(() => api.office());
$('attention').onclick = () => act(() => api.attention());
$('compact-ask').onclick = () => act(() => api.openAsk());
$('overflow').onclick = () => act(() => api.overflow());
$('question').oninput = () => { void api.saveDraft($('question').value).catch(() => {}); };
$('notice').onclick = () => { $('notice').hidden = true; };
$('ask-form').onsubmit = async event => {
  event.preventDefault();
  const text = $('question').value.trim();
  if (!text || submitting) return;
  submitting = true; $('send').disabled = true;
  try {
    await api.ask(text); $('question').value = ''; $('notice').hidden = true;
  } catch (error) {
    notice(error?.message?.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') || 'Could not submit. Your question is still here.');
  } finally { submitting = false; $('send').disabled = false; }
};
new ResizeObserver(overflow).observe($('windows'));
api.onState(render);
void api.state().then(render).catch(() => notice('Open Nucleas from the tray to reconnect.'));
