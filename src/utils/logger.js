function log(...args) {
  console.log(`[${new Date().toLocaleTimeString()}]`, ...args);
}

module.exports = { log };
