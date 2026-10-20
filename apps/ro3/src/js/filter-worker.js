// Runs PhotoFilters off the main thread so big images don't freeze the editor.
importScripts('photo-filters.js', 'color-grade.js');
self.onmessage = (e) => {
  const { id, filter, w, h, data, params, ctx, grade } = e.data;
  try {
    let out;
    if (grade) { const d = new Uint8ClampedArray(data); ColorGrade.applyToPixels(grade, d, 1); out = { width: w, height: h, data: d }; }
    else out = PhotoFilters.run(filter, { width: w, height: h, data: new Uint8ClampedArray(data) }, params, ctx);
    self.postMessage({ id, w: out.width, h: out.height, data: out.data.buffer }, [out.data.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
