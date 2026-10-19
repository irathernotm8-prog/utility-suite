// Pure playback-sync math. "pb" is the host's playback snapshot:
//   { t, paused, rate, at, live, lag, duration }
// where `at` is the host's clock (ms) when `t` was read, and for live streams
// `lag` is how far (s) the host sits behind its live edge.

export const SYNC = {
  hardSeek: 1.25,      // VOD drift (s) that triggers a seek
  softBand: 0.12,      // drift we consider perfectly synced
  nudge: 0.06,         // playbackRate adjustment used to close small gaps
  liveHardSeek: 2.5,   // live-lag difference that triggers a seek
  seekCooldown: 2000,  // ms after a seek before we'll seek again
  durationTolerance: 4 // s; bigger mismatch suggests an ad or a different video
};

export function projectedPosition(pb, hostNow) {
  if (!pb || !Number.isFinite(pb.t)) return null;
  if (pb.paused) return pb.t;
  return pb.t + Math.max(0, hostNow - pb.at) / 1000 * (pb.rate || 1);
}

export function projectedLag(pb, hostNow) {
  if (!pb || !pb.live || !Number.isFinite(pb.lag)) return null;
  // While playing, distance from the live edge stays constant; while paused it grows.
  return pb.paused ? pb.lag + Math.max(0, hostNow - pb.at) / 1000 : pb.lag;
}

export function isLive(video) {
  return !!video && (video.live || video.duration === Infinity || video.duration > 172800);
}

/**
 * Decide how a viewer's local video should move to match the host.
 * local: { t, paused, rate, duration, live, lag, ad, buffering }
 * Returns { status, drift, cmd } where cmd is null or
 *   { paused, seek?, seekLag?, rate }
 */
export function planCorrection(local, pb, hostNow, { localNow = hostNow, lastSeekAt = -Infinity } = {}) {
  if (!pb) return { status: 'waiting-host', drift: null, cmd: null };
  if (!local) return { status: 'no-video', drift: null, cmd: null };
  if (local.ad) return { status: 'ad', drift: null, cmd: null };

  const baseRate = pb.rate || 1;
  const cooled = localNow - lastSeekAt > SYNC.seekCooldown;
  const wantPaused = !!pb.paused;
  const cmd = { paused: wantPaused, rate: baseRate };

  if (pb.live || isLive(local)) {
    const targetLag = projectedLag(pb, hostNow);
    if (targetLag === null || !Number.isFinite(local.lag)) {
      return { status: 'live', drift: null, cmd: local.paused !== wantPaused ? cmd : null };
    }
    const drift = targetLag - local.lag; // positive: we are ahead of host
    if (Math.abs(drift) > SYNC.liveHardSeek && cooled) {
      return { status: 'seeking', drift, cmd: { ...cmd, seekLag: targetLag } };
    }
    const changed = local.paused !== wantPaused || Math.abs((local.rate || 1) - baseRate) > 0.001;
    return { status: Math.abs(drift) > SYNC.liveHardSeek ? 'seeking' : 'live-synced', drift, cmd: changed ? cmd : null };
  }

  if (Number.isFinite(pb.duration) && Number.isFinite(local.duration) && pb.duration > 0 && local.duration > 0
      && Math.abs(pb.duration - local.duration) > SYNC.durationTolerance) {
    return { status: 'mismatch', drift: null, cmd: null };
  }

  const target = projectedPosition(pb, hostNow);
  if (Number.isFinite(pb.duration) && target > pb.duration) {
    return finish(local, cmd, 0, pb.duration);
  }
  const drift = local.t - target; // positive: we are ahead
  const abs = Math.abs(drift);

  if (abs > SYNC.hardSeek || (wantPaused && abs > 0.25)) {
    if (!cooled && !wantPaused) return { status: 'seeking', drift, cmd: null };
    return { status: 'seeking', drift, cmd: { ...cmd, seek: target } };
  }
  if (wantPaused) {
    return { status: 'synced', drift, cmd: local.paused ? null : cmd };
  }
  if (local.buffering) return { status: 'buffering', drift, cmd: local.paused ? cmd : null };

  let rate = baseRate;
  if (abs > SYNC.softBand) rate = baseRate * (drift > 0 ? 1 - SYNC.nudge : 1 + SYNC.nudge);
  const needs = local.paused || Math.abs((local.rate || 1) - rate) > 0.001;
  return { status: abs > SYNC.softBand ? 'catching-up' : 'synced', drift, cmd: needs ? { ...cmd, rate } : null };
}

function finish(local, cmd, drift, duration) {
  const needs = !local.paused || Math.abs(local.t - duration) > 1;
  return { status: 'synced', drift, cmd: needs ? { ...cmd, paused: true, seek: duration } : null };
}

// Has the host's playback changed enough that viewers should hear about it now
// rather than at the next heartbeat?
export function significantChange(prev, next, now) {
  if (!prev || !next) return prev !== next;
  if (prev.paused !== next.paused || prev.rate !== next.rate || prev.live !== next.live) return true;
  if (next.live) return Math.abs((prev.lag ?? 0) - (next.lag ?? 0)) > 2;
  const expected = projectedPosition(prev, now);
  return Math.abs(expected - next.t) > 0.6;
}

export function describeDrift(status, drift) {
  switch (status) {
    case 'synced': case 'live-synced': return 'In sync';
    case 'catching-up': return drift > 0 ? `${drift.toFixed(1)}s ahead` : `${(-drift).toFixed(1)}s behind`;
    case 'seeking': return 'Jumping to the host';
    case 'buffering': return 'Buffering';
    case 'ad': return 'Watching an ad';
    case 'mismatch': return 'Different video';
    case 'no-video': return 'No video found';
    case 'waiting-host': return 'Waiting for host';
    case 'live': return 'Live';
    default: return '';
  }
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const s = Math.floor(seconds % 60), m = Math.floor(seconds / 60) % 60, h = Math.floor(seconds / 3600);
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
