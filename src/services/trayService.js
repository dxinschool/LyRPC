const fs = require('fs');
const os = require('os');
const { spawn } = require('child_process');
const readline = require('readline');
const { makeIcon, ensureRgbaPng, toIco } = require('../utils/icon');

class TrayService {
  constructor({ iconPath, trayScriptPath, log, onExit }) {
    this.iconPath = iconPath;
    this.trayScriptPath = trayScriptPath;
    this.log = log;
    this.onExit = onExit;
    this.trayProcess = null;
  }

  init() {
    try {
      if (process.platform === 'linux') {
        this.initLinuxTray();
      } else {
        this.initDesktopTray();
      }
    } catch (err) {
      this.log('[tray] init failed:', err.message);
    }
  }

  updateStatus(text) {
    if (!this.trayProcess) return;
    const clamped = String(text || '').substring(0, 128);

    try {
      if (process.platform === 'linux') {
        const msg = JSON.stringify({ type: 'update-status', text: clamped });
        this.trayProcess.stdin.write(`${msg}\n`);
      } else {
        this.trayProcess.sendAction({
          type: 'update-item',
          item: { title: clamped, tooltip: '', checked: false, enabled: false },
          seq_id: 0,
        });
      }
    } catch {}
  }

  dispose() {
    try {
      if (!this.trayProcess) return;
      if (process.platform === 'linux') {
        this.trayProcess.kill();
      } else {
        this.trayProcess.kill();
      }
    } catch {}
  }

  initLinuxTray() {
    const iconPath = fs.existsSync(this.iconPath)
      ? this.iconPath
      : this.writeFallbackIcon('.png', makeIcon(32, 29, 185, 84));

    this.trayProcess = spawn('python3', [this.trayScriptPath, iconPath], {
      stdio: ['pipe', 'pipe', 'inherit'],
    });

    this.trayProcess.on('exit', () => this.onExit());
    this.trayProcess.on('error', err => this.log('[tray] error:', err.message));

    const rl = readline.createInterface({ input: this.trayProcess.stdout });
    rl.on('line', line => {
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'ready') this.log('[tray] initialized');
        if (msg.type === 'clicked' && msg.item === 'exit') {
          this.dispose();
          this.onExit();
        }
      } catch {}
    });
  }

  initDesktopTray() {
    if (!process.env.GDK_BACKEND) process.env.GDK_BACKEND = 'x11';
    const SysTray = require('systray2').default;

    const iconBase64 = fs.existsSync(this.iconPath)
      ? toIco(ensureRgbaPng(fs.readFileSync(this.iconPath))).toString('base64')
      : toIco(makeIcon(32, 29, 185, 84)).toString('base64');

    this.trayProcess = new SysTray({
      menu: {
        icon: iconBase64,
        title: 'Spotify Lyrics RPC',
        tooltip: 'Spotify Lyrics RPC',
        items: [
          { title: 'Starting...', tooltip: '', checked: false, enabled: false },
          { title: '-', tooltip: '', checked: false, enabled: false },
          { title: 'Exit', tooltip: 'Quit the app', checked: false, enabled: true },
        ],
      },
      debug: false,
      copyDir: true,
    });

    this.trayProcess.onClick(action => {
      if (action.seq_id === 2) {
        this.dispose();
        this.onExit();
      }
    });

    this.log('[tray] initialized');
  }

  writeFallbackIcon(ext, content) {
    const iconPath = os.tmpdir() + `/spotify-lyrics-rpc-icon${ext}`;
    try {
      fs.writeFileSync(iconPath, content);
      return iconPath;
    } catch {
      return this.iconPath;
    }
  }
}

module.exports = { TrayService };
