const fs = require('fs');
const RPC = require('discord-rpc');
const WebSocket = require('ws');

const {
  CLIENT_ID,
  LANYARD_URL,
  RPC_LARGE_IMAGE_KEY,
  MUSIC_SERVICE_APP_IDS,
  USER_ID_PATH,
  CACHE_PATH,
  ICON_PATH,
  TRAY_SCRIPT_PATH,
} = require('./config');
const { log } = require('./utils/logger');
const { LyricsCache } = require('./services/cache');
const { LyricsService } = require('./services/lyricsService');
const { TrayService } = require('./services/trayService');

// ── Music service detection (Tidal, Apple Music, etc. via activities) ──
// Discord music integrations (non-Spotify) show up as LISTENING (type 2)
// activities in the `activities[]` array with:
//   details → song name
//   state   → artist name
//   assets.large_text → album name
//   timestamps.start/end → playback timestamps
// The activity `name` is often `"{song} by {artist}"`, NOT the service name.

function identifyMusicService(act) {
  // 1. Known application_id → service name
  const byAppId = MUSIC_SERVICE_APP_IDS[act.application_id];
  if (byAppId) return byAppId;

  // 2. Extract service name from asset URLs (e.g. resources.tidal.com → Tidal)
  const urls = [
    act.assets && (act.assets.large_url || act.assets.small_url),
    act.details_url,
    act.state_url,
  ].filter(Boolean);
  for (const url of urls) {
    if (url.includes('tidal.com')) return 'Tidal';
    if (url.includes('music.apple.com')) return 'Apple Music';
    if (url.includes('music.youtube.com')) return 'YouTube Music';
    if (url.includes('soundcloud.com')) return 'SoundCloud';
    if (url.includes('deezer.com')) return 'Deezer';
    if (url.includes('pandora.com')) return 'Pandora';
    if (url.includes('music.amazon') || url.includes('amazonmusic')) return 'Amazon Music';
  }

  // 3. Generic match: try to extract from activity name (e.g. "Tidal" might appear in some versions)
  if (act.name) {
    const lower = act.name.toLowerCase();
    if (lower.includes('tidal')) return 'Tidal';
    if (lower.includes('apple music')) return 'Apple Music';
    if (lower.includes('youtube music')) return 'YouTube Music';
    if (lower.includes('soundcloud')) return 'SoundCloud';
    if (lower.includes('deezer')) return 'Deezer';
    if (lower.includes('amazon')) return 'Amazon Music';
    if (lower.includes('pandora')) return 'Pandora';
  }

  return null;
}

function extractMusicFromActivities(activities) {
  if (!activities) return null;
  for (const act of activities) {
    // Must be a LISTENING activity with song + artist data
    if (act.type !== 2) continue;
    if (!act.details || !act.state) continue;
    if (!act.timestamps || !act.timestamps.start) continue;

    const source = identifyMusicService(act);

    return {
      song: act.details,
      artist: act.state,
      album: (act.assets && act.assets.large_text) || '',
      timestamps: { start: act.timestamps.start, end: act.timestamps.end },
      track_id: null,
      _source: source || 'music', // identified name, or generic fallback
    };
  }
  return null;
}

const TICK_MS = 1000;
const RPC_MIN_UPDATE_MS = 1500;

const USER_ID = fs.readFileSync(USER_ID_PATH, 'utf-8').trim();

const rpc = new RPC.Client({ transport: 'ipc' });

const cache = new LyricsCache(CACHE_PATH);
cache.load();

const lyricsService = new LyricsService(cache, log);

const tray = new TrayService({
  iconPath: ICON_PATH,
  trayScriptPath: TRAY_SCRIPT_PATH,
  log,
  onExit: () => process.exit(0),
});

const state = {
  spotify: null,
  lyrics: [],
  lineIndex: 0,
  fetchInFlight: false,
  appStartTime: 0,
  lastSpotifyKey: '',
  lastPayloadKey: '',
  lastRpcSentAt: 0,
};

rpc.on('ready', () => {
  log('[rpc] connected');
  tray.init();
  connectLanyard();
});

rpc.login({ clientId: CLIENT_ID }).catch(err => {
  log('[rpc] login failed:', err.message);
});

function connectLanyard() {
  const ws = new WebSocket(LANYARD_URL);

  ws.on('open', () => {
    ws.send(JSON.stringify({ op: 2, d: { subscribe_to_id: USER_ID } }));
    log('[lanyard] connected');
  });

  ws.on('message', raw => {
    const { op, t, d } = JSON.parse(raw);
    if (op !== 0) return;

    if (t === 'INIT_STATE') {
      // Prefer native Spotify data, fall back to Tidal / other music activities
      handleSpotify(d.spotify || extractMusicFromActivities(d.activities));
    }
    if (t === 'PRESENCE_UPDATE') {
      handleSpotify(d.spotify || extractMusicFromActivities(d.activities) || null);
    }
    if (t === 'SPOTIFY_UPDATE') handleSpotify(d);
  });

  ws.on('close', () => setTimeout(connectLanyard, 3000));
  ws.on('error', () => {});
}

function resetTrackState() {
  state.lyrics = [];
  state.lineIndex = 0;
  state.lastPayloadKey = '';
  state.appStartTime = Date.now();
}

function handleSpotify(s) {
  if (!s || !s.song) {
    if (state.spotify) log('[music] stopped');
    tray.updateStatus('Idle');

    state.spotify = null;
    state.lastSpotifyKey = '';
    state.fetchInFlight = false;
    resetTrackState();

    rpc.clearActivity().catch(() => {});
    return;
  }

  const src = s._source || 'spotify';
  const spotifyKey = `${s.song}|${s.artist}|${s.timestamps?.start}`;
  if (spotifyKey === state.lastSpotifyKey) return;

  state.lastSpotifyKey = spotifyKey;
  state.spotify = s;
  state.fetchInFlight = true;
  resetTrackState();

  if (src === 'spotify') {
    log(`[spotify] "${s.song}" — ${s.artist}`);
  } else {
    log(`[${src.toLowerCase()}] "${s.song}" — ${s.artist}`);
  }
  tray.updateStatus(`♪ ${s.song} — ${s.artist}`);

  const fetchId = lyricsService.nextFetchId();
  syncTick();

  lyricsService.fetchLyrics(s.song, s.artist, s.album, fetchId).then(result => {
    if (!lyricsService.isFetchCurrent(fetchId)) return;

    state.fetchInFlight = false;

    if (result.status === 'ok') {
      state.lyrics = result.lyrics;
      state.lineIndex = 0;
      state.lastPayloadKey = '';
      state.appStartTime = Date.now();
      log(`[lyrics] ${state.lyrics.length} grouped lines${result.cached ? ' (cached)' : ''}`);
    } else {
      state.lyrics = [];
      state.lineIndex = 0;
      state.lastPayloadKey = '';
    }

    syncTick();
  });
}

function getElapsedSeconds() {
  if (!state.spotify) return 0;
  const start = state.spotify.timestamps?.start || Date.now();
  return (Date.now() - start) / 1000;
}

function advanceLineIndex(elapsed) {
  if (state.lyrics.length === 0) return;
  if (state.lineIndex >= state.lyrics.length) {
    state.lineIndex = Math.max(0, state.lyrics.length - 2);
  }
  while (
    state.lineIndex < state.lyrics.length - 2 &&
    state.lyrics[state.lineIndex + 2].time <= elapsed
  ) {
    state.lineIndex += 2;
  }
}

function buildPayload() {
  const elapsed = getElapsedSeconds();
  advanceLineIndex(elapsed);

  const current = state.lyrics.length > 0 ? state.lyrics[state.lineIndex].text : '';
  const preview =
    state.lyrics.length > 0 && state.lineIndex + 1 < state.lyrics.length
      ? state.lyrics[state.lineIndex + 1].text
      : null;

  let details;
  let stateLine;
  if (state.lyrics.length > 0) {
    details = (current || '♪').substring(0, 128);
    stateLine = (preview || '♫ ').substring(0, 128);
  } else if (state.fetchInFlight) {
    details = '♪';
    stateLine = 'Fetching lyrics...';
  } else {
    details = (current || '♪').substring(0, 128);
    stateLine = 'Lyrics not found';
  }

  const largeImageKey = RPC_LARGE_IMAGE_KEY;
  // Only add "Open in Spotify" button when there's a valid Spotify track ID
  const spotifyTrackUrl = state.spotify.track_id
    ? `https://open.spotify.com/track/${encodeURIComponent(state.spotify.track_id)}`
    : null;

  return {
    details,
    stateLine,
    activity: {
      name: state.spotify.song.substring(0, 128),
      type: 2, // LISTENING — shows "Listening to <song>" instead of "Playing <app>"
      details,
      state: stateLine,
      largeImageKey,
      largeImageText: state.spotify.album || state.spotify.song,
      startTimestamp: Math.floor((state.appStartTime || Date.now()) / 1000),
      instance: false,
      buttons: spotifyTrackUrl ? [{ label: 'Open in Spotify', url: spotifyTrackUrl }] : undefined,
    },
  };
}

function syncTick() {
  if (!state.spotify) return;

  const payload = buildPayload();
  const payloadKey = `${payload.details}|||${payload.stateLine}`;
  const now = Date.now();
  const changed = payloadKey !== state.lastPayloadKey;
  const canSendByTime = now - state.lastRpcSentAt >= RPC_MIN_UPDATE_MS;

  tray.updateStatus(`♪ ${state.spotify.song} — ${state.spotify.artist}`);

  if (!changed && !canSendByTime) return;

  state.lastPayloadKey = payloadKey;
  state.lastRpcSentAt = now;

  const src = (state.spotify._source || 'spotify').toLowerCase();
  log(
    `[${src}] rpc: "${payload.details.substring(0, 50)}" | "${payload.stateLine.substring(0, 50)}"`
  );

  rpc.setActivity(payload.activity).catch(err => {
    if (err.message && err.message.toLowerCase().includes('rate')) {
      log(`[rpc] RATE LIMITED: ${err.message}`);
    } else {
      log(`[rpc] error: ${err.message}`);
    }
  });
}

setInterval(syncTick, TICK_MS);
log('[boot] ready');
