// Local test sites: a page with the video in a cross-origin iframe (9101 -> 9102),
// a plain video page, and a direct .mp4 link.
import http from 'node:http';
import fs from 'node:fs';
export function startSites(media) {
  const page = body => `<!doctype html><html><body style="margin:0;background:#222;color:#fff;font:16px sans-serif">${body}</body></html>`;
  function video(req, res) {
    const size = fs.statSync(media).size;
    const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (m) {
      const start = Number(m[1] || 0), end = m[2] ? Number(m[2]) : size - 1;
      res.writeHead(206, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': end - start + 1 });
      fs.createReadStream(media, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': size });
      fs.createReadStream(media).pipe(res);
    }
  }
  const html = (res, body) => { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(page(body)); };
  const a = http.createServer((req, res) => {
    if (req.url.startsWith('/test.mp4')) return video(req, res);
    if (req.url.startsWith('/framed')) return html(res, `<h1>Some site</h1><iframe src="http://localhost:9102/player" style="width:800px;height:450px;border:0" allow="autoplay; fullscreen"></iframe>`);
    html(res, `<video src="/test.mp4" controls style="width:100%"></video>`);
  }).listen(9101, '127.0.0.1');
  const b = http.createServer((req, res) => {
    if (req.url.startsWith('/test.mp4')) return video(req, res);
    html(res, `<video src="/test.mp4" controls style="width:100%;height:100vh"></video>`);
  }).listen(9102, '127.0.0.1');
  return () => { a.close(); b.close(); };
}
