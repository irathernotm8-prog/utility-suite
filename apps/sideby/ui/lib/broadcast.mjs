// Broadcast: the host streams a page, window or screen (with audio where the
// OS allows) to everyone over WebRTC. Everyone sees the same frame, so this is
// the right mode for live sports and anything that can't be synced.

export const QUALITY = {
  '720p30': { label: '720p · 30 fps', width: 1280, height: 720, fps: 30, bitrate: 2_500_000 },
  '720p60': { label: '720p · 60 fps', width: 1280, height: 720, fps: 60, bitrate: 4_000_000 },
  '1080p30': { label: '1080p · 30 fps', width: 1920, height: 1080, fps: 30, bitrate: 4_500_000 },
  '1080p60': { label: '1080p · 60 fps', width: 1920, height: 1080, fps: 60, bitrate: 8_000_000 }
};

const META = { kind: 'broadcast' };

export class Broadcaster {
  constructor({ net, bridge, onStop }) {
    this.net = net;
    this.bridge = bridge;
    this.onStop = onStop;
    this.stream = null;
    this.kind = null;
    this.quality = QUALITY['1080p30'];
  }

  get active() { return !!this.stream; }

  async start({ kind, sourceId, quality = '1080p30', label }) {
    this.stop(false);
    this.quality = QUALITY[quality] || QUALITY['1080p30'];
    const { width, height, fps } = this.quality;
    const video = { width: { ideal: width }, height: { ideal: height }, frameRate: { ideal: fps, max: fps } };
    const attempt = async (withAudio, macAudio) => {
      await this.bridge.capture.prepare(kind === 'stage' ? { kind: 'stage' } : { kind: 'source', id: sourceId, audio: macAudio });
      return navigator.mediaDevices.getDisplayMedia({ video, audio: withAudio, systemAudio: 'include' });
    };
    let stream;
    try {
      stream = await attempt(true, true);
    } catch (error) {
      if (kind === 'stage') throw error;
      stream = await attempt(false, false); // system audio isn't available on this computer
    }
    this.stream = stream;
    this.kind = kind;
    this.label = label;
    for (const track of stream.getVideoTracks()) {
      track.contentHint = 'motion';
      track.addEventListener('ended', () => this.stop());
    }
    this.hasAudio = stream.getAudioTracks().length > 0;
    await Promise.allSettled(this.net.room.addStream(stream, { metadata: META }));
    this.tune();
    setTimeout(() => this.tune(), 1500);
    return stream;
  }

  addPeer(peerId) {
    if (!this.stream) return;
    Promise.allSettled(this.net.room.addStream(this.stream, { target: peerId, metadata: META }))
      .then(() => { this.tune(); setTimeout(() => this.tune(), 1500); });
  }

  // Encoder settings: favour smooth motion, cap bitrate per friend.
  tune() {
    if (!this.stream) return;
    const tracks = new Set(this.stream.getTracks());
    for (const pc of Object.values(this.net.room.getPeers())) {
      for (const sender of pc.getSenders()) {
        if (!sender.track || !tracks.has(sender.track)) continue;
        try {
          const params = sender.getParameters();
          if (!params.encodings || !params.encodings.length) params.encodings = [{}];
          if (sender.track.kind === 'video') {
            params.encodings[0].maxBitrate = this.quality.bitrate;
            params.encodings[0].maxFramerate = this.quality.fps;
            params.degradationPreference = this.quality.fps >= 60 ? 'maintain-framerate' : 'balanced';
          } else {
            params.encodings[0].maxBitrate = 160_000;
          }
          sender.setParameters(params).catch(() => {});
        } catch {}
      }
    }
  }

  stop(notify = true) {
    if (!this.stream) return;
    const stream = this.stream;
    this.stream = null;
    try { this.net.room.removeStream(stream); } catch {}
    for (const track of stream.getTracks()) track.stop();
    this.kind = null;
    if (notify) this.onStop?.();
  }
}

// Receiver-side stats for the little quality readout.
export async function inboundStats(pc, previous) {
  if (!pc) return null;
  const stats = await pc.getStats();
  let video = null, rtt = null;
  stats.forEach(s => {
    if (s.type === 'inbound-rtp' && s.kind === 'video') video = s;
    if (s.type === 'candidate-pair' && s.nominated && s.currentRoundTripTime) rtt = Math.round(s.currentRoundTripTime * 1000);
  });
  if (!video) return null;
  const now = video.timestamp;
  const bytes = video.bytesReceived;
  const kbps = previous && previous.timestamp ? Math.round((bytes - previous.bytes) * 8 / (now - previous.timestamp)) : null;
  return { timestamp: now, bytes, kbps, fps: video.framesPerSecond ? Math.round(video.framesPerSecond) : null, width: video.frameWidth, height: video.frameHeight, rtt, lost: video.packetsLost };
}
