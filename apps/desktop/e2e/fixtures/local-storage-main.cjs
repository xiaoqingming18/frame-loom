// 只供 URL 素材 E2E：生产桌面与 engine 不包含此启动器。
const { app, utilityProcess } = require('electron');
const path = require('node:path');
app.setAppPath(path.resolve(__dirname, '../..'));
const fork = utilityProcess.fork.bind(utilityProcess);
utilityProcess.fork = (entry, args, options) =>
  fork(
    entry.replaceAll('\\', '/').endsWith('/engine/dist/main.js')
      ? path.join(__dirname, 'local-storage-engine.mjs')
      : entry,
    args,
    options,
  );
void import('../../out/main/index.js');
