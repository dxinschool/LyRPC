const fs = require('fs');

class LyricsCache {
  constructor(cachePath) {
    this.cachePath = cachePath;
    this.data = {};
  }

  load() {
    try {
      this.data = JSON.parse(fs.readFileSync(this.cachePath, 'utf-8'));
    } catch {
      this.data = {};
    }
  }

  get(key) {
    return this.data[key];
  }

  set(key, value) {
    this.data[key] = value;
    this.save();
  }

  save() {
    try {
      fs.writeFileSync(this.cachePath, JSON.stringify(this.data));
    } catch {}
  }
}

module.exports = { LyricsCache };
