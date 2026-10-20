// Image Trace worker for the Vector workspace: runs imagetracerjs (public domain) off the main thread.
importScripts('../vendor/imagetracer.js');
self.onmessage = e => {
  const { id, imageData, opts } = e.data;
  try {
    const svg = self.ImageTracer.imagedataToSVG(imageData, opts);
    self.postMessage({ id, svg });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
