// Raster → vector tracing. Runs inside a worker thread so the app never freezes.
const { parentPort, workerData } = require('worker_threads');
const ImageTracer = require('imagetracerjs');
const potrace = require('potrace');

const COLOR_PRESETS = {
  logo:     { numberofcolors: 8,  ltres: 1,   qtres: 1,   pathomit: 10, blurradius: 0, colorquantcycles: 3, roundcoords: 1 },
  balanced: { numberofcolors: 16, ltres: 1,   qtres: 1,   pathomit: 8,  blurradius: 0, colorquantcycles: 3, roundcoords: 1 },
  detailed: { numberofcolors: 48, ltres: 0.5, qtres: 0.5, pathomit: 2,  blurradius: 0, colorquantcycles: 4, roundcoords: 2 },
};
const BW_PRESETS = {
  logo:     { turdSize: 8, alphaMax: 1.0, optTolerance: 0.4 },
  balanced: { turdSize: 4, alphaMax: 1.0, optTolerance: 0.2 },
  detailed: { turdSize: 1, alphaMax: 0.8, optTolerance: 0.1 },
};

function sizeSvg(svg, outW, outH, traceW, traceH) {
  // Make sure the SVG scales to the original pixel size, keeping the traced viewBox.
  return svg.replace(/<svg\b([^>]*)>/, (m, attrs) => {
    let a = attrs.replace(/\s(width|height|viewBox|viewbox)="[^"]*"/g, '');
    return `<svg${a} width="${outW}" height="${outH}" viewBox="0 0 ${traceW} ${traceH}">`;
  });
}

function run() {
  const { mode, preset, colors, threshold, fill, raw, png, width, height, outW, outH } = workerData;
  if (mode === 'color') {
    const opts = Object.assign({}, COLOR_PRESETS[preset] || COLOR_PRESETS.balanced, { viewbox: true, strokewidth: 0, linefilter: preset !== 'detailed' });
    if (colors) opts.numberofcolors = colors;
    const imgd = { width, height, data: new Uint8ClampedArray(raw.buffer, raw.byteOffset, raw.byteLength) };
    let svg = ImageTracer.imagedataToSVG(imgd, opts);
    // imagetracer emits a desc comment and stroke attributes we don't need
    svg = svg.replace(/<desc>.*?<\/desc>/, '');
    return Promise.resolve(sizeSvg(svg, outW, outH, width, height));
  }
  const base = Object.assign({}, BW_PRESETS[preset] || BW_PRESETS.balanced);
  if (mode === 'bw') {
    return new Promise((resolve, reject) => {
      potrace.trace(Buffer.from(png), Object.assign(base, {
        threshold: threshold == null ? potrace.Potrace.THRESHOLD_AUTO : threshold,
        color: fill || '#000000', background: 'transparent',
      }), (err, svg) => err ? reject(err) : resolve(sizeSvg(svg, outW, outH, width, height)));
    });
  }
  // posterized: stacked grayscale layers
  return new Promise((resolve, reject) => {
    potrace.posterize(Buffer.from(png), Object.assign(base, {
      steps: Math.max(2, Math.min(8, colors || 4)), color: fill || '#000000', background: 'transparent',
    }), (err, svg) => err ? reject(err) : resolve(sizeSvg(svg, outW, outH, width, height)));
  });
}

run().then(svg => parentPort.postMessage({ ok: true, svg }))
  .catch(e => parentPort.postMessage({ ok: false, error: String(e && e.message || e) }));
