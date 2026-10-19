// Sideby's built-in player for direct video files, HLS streams and local files.
// The stage preload syncs this <video> exactly like a video on any website.
(() => {
  const params = new URLSearchParams(location.search);
  const src = params.get('src') || '';
  const name = params.get('name');
  const video = document.getElementById('v');
  const msg = document.getElementById('msg');
  const show = (title, body) => {
    document.getElementById('msg-title').textContent = title;
    document.getElementById('msg-body').textContent = body;
    msg.hidden = false;
  };
  document.title = name || decodeURIComponent(src.split('/').pop()?.split('?')[0] || 'Video');

  if (!/^(https?|sideby-media):/i.test(src)) return show('Can’t play this link', 'Sideby only plays web links and files you choose.');

  const isHls = /\.m3u8(\?|#|$)/i.test(src) || params.get('type') === 'hls';
  video.addEventListener('error', () => {
    const code = video.error?.code;
    if (code === 4) show('This format won’t play here', 'Try an MP4 or WebM file, or use Broadcast to share it from another app.');
    else show('The video stopped loading', 'Check the link, or reload the page on stage.');
  });
  video.addEventListener('playing', () => { msg.hidden = true; });

  if (isHls && window.Hls?.isSupported()) {
    const hls = new Hls({ lowLatencyMode: false, liveSyncDurationCount: 3, enableWorker: true });
    hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
      if (data.levels?.some(l => l.details?.live)) document.documentElement.dataset.live = '1';
      video.play().catch(() => {});
    });
    hls.on(Hls.Events.LEVEL_LOADED, (_e, data) => { if (data.details?.live) document.documentElement.dataset.live = '1'; });
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        if (data.response?.code === 403 || data.response?.code === 0) show('The stream refused to load', 'This server blocks players outside its own site. Open its web page on stage instead, or Broadcast it.');
        else hls.startLoad();
      } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
      else show('This stream can’t be played', data.details || 'Unknown error');
    });
    hls.loadSource(src);
    hls.attachMedia(video);
  } else {
    video.src = src;
  }
})();
