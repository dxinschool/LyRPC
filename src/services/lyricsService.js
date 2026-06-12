const { parseLRC, groupLyrics } = require('../utils/lrc');

class LyricsService {
  constructor(cache, log) {
    this.cache = cache;
    this.log = log;
    this.fetchId = 0;
  }

  nextFetchId() {
    this.fetchId += 1;
    return this.fetchId;
  }

  isFetchCurrent(id) {
    return id === this.fetchId;
  }

  async fetchLyrics(song, artist, album, id) {
    const cacheKey = `${song}|${artist}|${album}`;
    const cached = this.cache.get(cacheKey);

    if (cached !== undefined) {
      this.log(`[lyrics] fetch #${id} — cache hit`);
      if (cached) {
        const grouped = groupLyrics(parseLRC(cached));
        return { status: 'ok', lyrics: grouped, cached: true };
      }
      return { status: 'not_found', lyrics: [], cached: true };
    }

    const params = new URLSearchParams({
      track_name: song,
      artist_name: artist,
      album_name: album,
    });

    this.log(`[lyrics] fetch #${id} — requesting...`);
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const res = await fetch(`https://lrclib.net/api/get?${params}`, { signal: controller.signal });
      clearTimeout(timeout);

      this.log(`[lyrics] fetch #${id} — ${res.status} ${res.statusText}`);

      if (!res.ok) {
        this.cache.set(cacheKey, null);
        return { status: 'not_found', lyrics: [], cached: false };
      }

      const data = await res.json();
      if (!this.isFetchCurrent(id)) {
        this.log(`[lyrics] fetch #${id} — stale, discarding`);
        return { status: 'stale', lyrics: [] };
      }

      if (data.syncedLyrics) {
        this.cache.set(cacheKey, data.syncedLyrics);
        const grouped = groupLyrics(parseLRC(data.syncedLyrics));
        this.log(`[lyrics] fetch #${id} — ${grouped.length} grouped lines`);
        return { status: 'ok', lyrics: grouped, cached: false };
      }

      this.cache.set(cacheKey, null);
      return { status: 'not_found', lyrics: [], cached: false };
    } catch (err) {
      this.log(`[lyrics] fetch #${id} — error: ${err.message}`);
      return { status: 'error', lyrics: [], error: err };
    }
  }
}

module.exports = { LyricsService };
