const api = window.nucleasAttention, $ = id => document.getElementById(id);
let last;
const fail = message => { $('error').textContent = message; $('error').hidden = !message; };
function render(state) {
  $('interval').value = String(state.intervalMinutes); $('count').textContent = state.items.length ? `· ${state.items.length}` : '';
  fail(state.error);
  const signature = JSON.stringify(state.items); if (last === signature) return; last = signature;
  $('items').replaceChildren(...state.items.map(item => {
    const button = document.createElement('button'), company = document.createElement('small'), title = document.createElement('strong'), detail = document.createElement('span');
    company.textContent = `${item.companyName} · ${item.employeeName}`; title.textContent = item.title; detail.textContent = item.detail;
    button.append(company, title, detail); button.onclick = () => api.open(item.id).catch(() => fail('This item could not open. Try again from Office.')); return button;
  }));
  if (!state.items.length) { const empty = document.createElement('p'); empty.textContent = 'Nothing needs you right now.'; $('items').append(empty); }
}
$('close').onclick = () => api.close();
$('interval').onchange = async event => { const value = Number(event.target.value); $('interval').disabled = true; try { await api.interval(value); fail(''); } catch { await api.state().then(render).catch(()=>{}); fail('Could not save your email frequency. Try again.'); } finally { $('interval').disabled = false; } };
api.onState(render); void api.state().then(render).catch(() => fail('Could not connect to Nucleas.'));
