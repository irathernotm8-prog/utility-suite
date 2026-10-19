// Shared format catalogue used by the main process and (via IPC) the renderer.

const IMAGE_IN = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'gif', 'tif', 'tiff', 'bmp', 'ico', 'svg', 'jxl', 'psd'];
const VIDEO_IN = ['mp4', 'mkv', 'mov', 'm4v', 'webm', 'avi', 'wmv', 'flv', 'mpg', 'mpeg', 'ts', 'mts', 'm2ts', '3gp', 'ogv'];
const AUDIO_IN = ['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wma', 'aiff', 'aif'];

const IMAGE_OUT = [
  { ext: 'png', label: 'PNG' },
  { ext: 'jpg', label: 'JPG' },
  { ext: 'webp', label: 'WebP' },
  { ext: 'avif', label: 'AVIF' },
  { ext: 'tiff', label: 'TIFF' },
  { ext: 'gif', label: 'GIF' },
  { ext: 'bmp', label: 'BMP' },
  { ext: 'ico', label: 'ICO (icon)' },
  { ext: 'pdf', label: 'PDF' },
  { ext: 'psd', label: 'PSD (Photoshop)' },
  { ext: 'svg', label: 'SVG (vector trace)' },
];
const VIDEO_OUT = [
  { ext: 'mp4', label: 'MP4 (H.264)' },
  { ext: 'mkv', label: 'MKV' },
  { ext: 'mov', label: 'MOV' },
  { ext: 'webm', label: 'WebM (VP9)' },
  { ext: 'avi', label: 'AVI' },
  { ext: 'm4v', label: 'M4V' },
  { ext: 'gif', label: 'GIF (animated)' },
];
const AUDIO_OUT = [
  { ext: 'mp3', label: 'MP3' },
  { ext: 'wav', label: 'WAV' },
  { ext: 'm4a', label: 'M4A (AAC)' },
  { ext: 'flac', label: 'FLAC' },
  { ext: 'ogg', label: 'OGG (Vorbis/Opus)' },
  { ext: 'opus', label: 'Opus' },
];

function extOf(p) {
  const m = /\.([^.\\/]+)$/.exec(p || '');
  return m ? m[1].toLowerCase() : '';
}

function kindOf(p) {
  const e = extOf(p);
  if (IMAGE_IN.includes(e)) return 'image';
  if (VIDEO_IN.includes(e)) return 'video';
  if (AUDIO_IN.includes(e)) return 'audio';
  if (e === 'ro3') return 'project';
  return 'unknown';
}

// Which outputs make sense for a given input kind.
function targetsFor(kind) {
  if (kind === 'image') return IMAGE_OUT;
  if (kind === 'video') return [...VIDEO_OUT, ...AUDIO_OUT.map(a => ({ ...a, label: a.label + ' (audio only)' }))];
  if (kind === 'audio') return AUDIO_OUT;
  return [];
}

module.exports = { IMAGE_IN, VIDEO_IN, AUDIO_IN, IMAGE_OUT, VIDEO_OUT, AUDIO_OUT, extOf, kindOf, targetsFor };
