const button = document.getElementById('signin');
const status = document.getElementById('status');
window.nucleasDesktop.onAuthStatus(message => { status.textContent = message; });
button.onclick = async () => {
  button.disabled = true;
  status.textContent = 'Opening your browser…';
  try { await window.nucleasDesktop.signIn(); }
  catch { status.textContent = 'Could not complete sign-in. Check your connection and try again.'; }
  finally { button.disabled = false; }
};
