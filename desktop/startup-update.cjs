/** Hold startup until the updater is current, has a verified download, or cannot proceed.
 * A late download after a timeout belongs to the normal background update flow.
 */
function startupUpdate(updater, { checkTimeoutMs = 15000, downloadTimeoutMs = 120000 } = {}) {
  return new Promise(resolve => {
    let timer, settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const [event, handler] of Object.entries(handlers)) updater.removeListener(event, handler);
      resolve(result);
    };
    const deadline = ms => { clearTimeout(timer); timer = setTimeout(() => finish('deferred'), ms); };
    const handlers = {
      'update-available': () => deadline(downloadTimeoutMs),
      'update-not-available': () => finish('current'),
      'update-downloaded': () => finish('ready'),
      error: () => finish('unavailable'),
    };
    for (const [event, handler] of Object.entries(handlers)) updater.on(event, handler);
    deadline(checkTimeoutMs);
    try { Promise.resolve(updater.checkForUpdates()).catch(() => finish('unavailable')); }
    catch { finish('unavailable'); }
  });
}
module.exports = { startupUpdate };
