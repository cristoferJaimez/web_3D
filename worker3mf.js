/* Lee el 3MF en segundo plano para que la página no se congele con archivos grandes */
importScripts("https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js", "parser3mf.js?v=3");

self.onmessage = (e) => {
  const { buffer, bed } = e.data;
  try {
    const res = self.parse3MFBuffer(buffer, bed, (stage, p) => self.postMessage({ type: "progress", stage, p }));
    self.postMessage({ type: "done", res }, res.plates.map((pl) => pl.positions.buffer));
  } catch (err) {
    self.postMessage({ type: "error", message: String(err && err.message || err) });
  }
};
