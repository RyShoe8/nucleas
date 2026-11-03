const fs = require('node:fs');
const path = require('node:path');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
module.exports = async function probe(app, launcher, label) {
  const samples = [];
  launcher.show();
  await wait(5000);
  app.getAppMetrics();
  for (let i = 0; i < 12; i++) {
    if (i === 6) launcher.hide();
    await wait(5000);
    const metrics = app.getAppMetrics();
    samples.push({ second: (i + 1) * 5, visible: i < 6, processes: metrics.length,
      workingSetMB: Math.round(metrics.reduce((sum, item) => sum + item.memory.workingSetSize, 0) / 1024 * 10) / 10,
      cpuPercent: Math.round(metrics.reduce((sum, item) => sum + item.cpu.percentCPUUsage, 0) * 100) / 100 });
  }
  fs.mkdirSync(path.join(__dirname, 'release'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, `release/resources-${label}.json`), JSON.stringify({ scope: 'Native launcher only; no authenticated business apps loaded', samples }, null, 2));
};
