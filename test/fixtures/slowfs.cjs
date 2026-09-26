// Slow-disk stand-in (verify 第 7 轮 FLUSH): every async fs.write / fs.writev /
// fs.open callback lands 80 ms late, the way a busy disk or a queued libuv
// thread pool delays them. Preloaded with NODE_OPTIONS=--require, so every
// child (apply_batch, drivers, recorder) sees the same slow disk.
const fs = require('fs');
for (const name of ['write', 'writev', 'open']) {
  const orig = fs[name];
  fs[name] = function slowed(...args) {
    const cb = args[args.length - 1];
    if (typeof cb !== 'function') return orig.apply(this, args);
    args[args.length - 1] = (...r) => setTimeout(() => cb(...r), 80);
    return orig.apply(this, args);
  };
}
