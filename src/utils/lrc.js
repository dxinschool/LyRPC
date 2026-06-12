function parseLRC(lrc) {
  return lrc
    .split('\n')
    .map(line => {
      const m = line.match(/\[(\d+):(\d+)\.(\d+)\](.*)/);
      if (!m) return null;
      const time = Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 100;
      return { time, text: m[4].trim() };
    })
    .filter(Boolean);
}

function groupLyrics(lines, window = 1.0) {
  if (!lines.length) return [];
  const groups = [{ time: lines[0].time, texts: [lines[0].text] }];
  for (let i = 1; i < lines.length; i++) {
    const g = groups[groups.length - 1];
    const gap = lines[i].time - lines[i - 1].time;
    const short = lines[i].text.split(' ').length < 3;
    if ((gap <= window || short) && g.texts.length < 3) {
      const last = g.texts[g.texts.length - 1];
      const dupMatch = last.match(/^(.+) \(x(\d+)\)$/);
      if (dupMatch && dupMatch[1] === lines[i].text) {
        g.texts[g.texts.length - 1] = `${dupMatch[1]} (x${Number(dupMatch[2]) + 1})`;
      } else if (lines[i].text === last) {
        g.texts[g.texts.length - 1] = `${lines[i].text} (x2)`;
      } else {
        g.texts.push(lines[i].text);
      }
    } else {
      groups.push({ time: lines[i].time, texts: [lines[i].text] });
    }
  }
  return groups.map(g => ({ time: g.time, text: g.texts.join(' | ') }));
}

module.exports = { parseLRC, groupLyrics };
