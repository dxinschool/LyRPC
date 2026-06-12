const path = require('path');

const ROOT_DIR = path.join(__dirname, '..');

module.exports = {
  CLIENT_ID: '1502317802604728453',
  LANYARD_URL: 'wss://api.lanyard.rest/socket',
  // Must match an image key uploaded in Discord Developer Portal > Rich Presence > Art Assets
  RPC_LARGE_IMAGE_KEY: 'img_chara-mygo_png',
  // Music services detected from Discord activities (besides native Spotify)
  // Map of Discord application_id → service name for identification.
  // Each app_id identifies a specific music service's Discord integration.
  // If your service isn't here, the generic detector (type=LISTENING + URLs) should still catch it.
  MUSIC_SERVICE_APP_IDS: {
    '1130698654987067493': 'Tidal',
  },
  ROOT_DIR,
  USER_ID_PATH: path.join(ROOT_DIR, 'id'),
  CACHE_PATH: path.join(ROOT_DIR, 'lyrics-cache.json'),
  ICON_PATH: path.join(ROOT_DIR, 'icon.png'),
  TRAY_SCRIPT_PATH: path.join(__dirname, 'tray.py'),
};
