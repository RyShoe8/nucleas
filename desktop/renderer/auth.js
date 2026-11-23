const button = document.getElementById('signin');
const status = document.getElementById('status');
const email = document.getElementById('email');
const cancel = document.getElementById('cancel');
window.nucleasDesktop.onAuthStatus(message => { status.textContent = message; });
async function signIn(method) {
  button.disabled = true; email.hidden = true; cancel.hidden = false;
  status.textContent = 'Connecting securely…';
  try { await window.nucleasDesktop.signIn(method); }
  catch { status.textContent = 'Sign-in did not finish. Try again when you’re ready.'; }
  finally { button.disabled = false; email.hidden = false; cancel.hidden = true; }
}
button.onclick = () => signIn('google');
email.onclick = () => signIn('email');
cancel.onclick = () => { void window.nucleasDesktop.cancelSignIn().catch(() => {}); };
