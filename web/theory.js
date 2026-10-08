/* Tonal — key, mode and tempo theory.
   Modes, tonic spellings and "relative keys" follow Hooktheory's key cheat sheets
   (hooktheory.com/cheat-sheet): seven modes ordered brightest → darkest, and every
   key belongs to a family of relative modes that share one key signature. */

const Theory = (() => {
  const MODES = [
    { id: 'lydian',     name: 'Lydian',     degree: 3, offset: 5,  side: 'B', mood: 'Dreamy and floating — a major scale with a raised 4th.' },
    { id: 'major',      name: 'Major',      degree: 0, offset: 0,  side: 'B', mood: 'Bright and resolved — the home of most pop.' },
    { id: 'mixolydian', name: 'Mixolydian', degree: 4, offset: 7,  side: 'B', mood: 'Major with a flat 7th — funk, gospel, rock swagger.' },
    { id: 'dorian',     name: 'Dorian',     degree: 1, offset: 2,  side: 'A', mood: 'Minor with a raised 6th — soulful, groovy, hopeful.' },
    { id: 'minor',      name: 'Minor',      degree: 5, offset: 9,  side: 'A', mood: 'Dark and emotional — natural minor (Aeolian).' },
    { id: 'phrygian',   name: 'Phrygian',   degree: 2, offset: 4,  side: 'A', mood: 'Minor with a flat 2nd — tense, Spanish, metal.' },
    { id: 'locrian',    name: 'Locrian',    degree: 6, offset: 11, side: 'A', mood: 'Unstable — the tonic chord is diminished.' },
  ];
  const MODE = Object.fromEntries(MODES.map(m => [m.id, m]));

  // Tonic spellings exactly as Hooktheory lists them for each mode.
  const HOOK_TONICS = {
    major:      ['A♭','A','B♭','B','C','D♭','D','E♭','E','F','F♯','G'],
    minor:      ['A','B♭','B','C','C♯','D','D♯','E','F','F♯','G','G♯'],
    dorian:     ['A','B♭','B','C','C♯','D','E♭','E','F','F♯','G','G♯'],
    mixolydian: ['A♭','A','B♭','B','C','C♯','D','E♭','E','F','F♯','G'],
    lydian:     ['A♭','A','B♭','B','C','D♭','D','E♭','E','F','G♭','G'],
    phrygian:   ['A','A♯','B','C','C♯','D','D♯','E','F','F♯','G','G♯'],
    locrian:    ['A','A♯','B','C','C♯','D','D♯','E','E♯','F♯','G','G♯'],
  };
  const LETTERS = ['C','D','E','F','G','A','B'];
  const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const MAJOR_STEPS = [0, 2, 4, 5, 7, 9, 11];

  function nameToPc(name) {
    let pc = LETTER_PC[name[0]];
    for (const ch of name.slice(1)) pc += ch === '♯' ? 1 : ch === '♭' ? -1 : 0;
    return (pc + 12) % 12;
  }
  const SPELLING = {};
  for (const [mode, names] of Object.entries(HOOK_TONICS)) {
    SPELLING[mode] = {};
    for (const n of names) SPELLING[mode][nameToPc(n)] = n;
  }

  const tonicName = (tonic, mode) => SPELLING[mode][tonic];
  const keyName = (tonic, mode) => `${tonicName(tonic, mode)} ${MODE[mode].name}`;
  const parentMajor = (tonic, mode) => (tonic - MODE[mode].offset + 12) % 12;

  function camelot(tonic, mode) {
    const num = (parentMajor(tonic, mode) * 7 + 7) % 12 + 1;
    const letter = MODE[mode].side;
    return { num, letter, code: `${num}${letter}` };
  }

  function camelotToKey(num, letter) {
    const major = (((num - 8) * 7) % 12 + 12) % 12;
    return letter === 'B' ? { tonic: major, mode: 'major' } : { tonic: (major + 9) % 12, mode: 'minor' };
  }

  // Key signature of a Camelot number: count + the altered notes.
  function signatureOf(num) {
    const fifths = ((num - 8) % 12 + 12) % 12; // sharps if ≤ 6
    if (fifths === 0) return { count: 0, type: 'none', notes: [], text: 'No sharps or flats' };
    if (fifths <= 6) {
      const notes = ['F♯','C♯','G♯','D♯','A♯','E♯'].slice(0, fifths);
      return { count: fifths, type: 'sharp', notes, text: `${fifths} sharp${fifths > 1 ? 's' : ''}` };
    }
    const n = 12 - fifths;
    const notes = ['B♭','E♭','A♭','D♭','G♭'].slice(0, n);
    return { count: n, type: 'flat', notes, text: `${n} flat${n > 1 ? 's' : ''}` };
  }

  function scaleNotes(tonic, mode) {
    const name = tonicName(tonic, mode);
    const li = LETTERS.indexOf(name[0]);
    const deg = MODE[mode].degree;
    return Array.from({ length: 7 }, (_, i) => {
      const step = (MAJOR_STEPS[(deg + i) % 7] - MAJOR_STEPS[deg] + 12) % 12;
      const target = (tonic + step) % 12;
      const letter = LETTERS[(li + i) % 7];
      const acc = ((target - LETTER_PC[letter] + 18) % 12) - 6;
      return letter + ({ '-2': '𝄫', '-1': '♭', '0': '', '1': '♯', '2': '𝄪' })[acc];
    });
  }

  function pcSet(tonic, mode) {
    const deg = MODE[mode].degree;
    return new Set(Array.from({ length: 7 }, (_, i) => (tonic + MAJOR_STEPS[(deg + i) % 7] - MAJOR_STEPS[deg] + 12) % 12));
  }

  // All seven relative modes that share a Camelot number, brightest first.
  function family(num) {
    const parent = camelotToKey(num, 'B').tonic;
    return MODES.map(m => ({ tonic: (parent + m.offset) % 12, mode: m.id }));
  }

  const hooktheoryUrl = (tonic, mode) => {
    const n = tonicName(tonic, mode);
    const slug = n[0].toLowerCase() + (n.includes('♭') ? '-flat' : n.includes('♯') ? '-sharp' : '');
    return `https://www.hooktheory.com/cheat-sheet/key/${slug}/${mode}`;
  };

  /* ---------- parsing ---------- */

  const MODE_ALIASES = {
    '': 'major', maj: 'major', major: 'major', ionian: 'major', ion: 'major', dur: 'major',
    m: 'minor', min: 'minor', minor: 'minor', aeolian: 'minor', aeol: 'minor', moll: 'minor',
    dorian: 'dorian', dor: 'dorian',
    phrygian: 'phrygian', phryg: 'phrygian', phr: 'phrygian',
    lydian: 'lydian', lyd: 'lydian',
    mixolydian: 'mixolydian', mixo: 'mixolydian', mix: 'mixolydian', mixolyd: 'mixolydian',
    locrian: 'locrian', loc: 'locrian',
  };

  function parseSimple(s) {
    s = s.trim().toLowerCase().replace(/^(key of|in)\s+/, '').replace(/\s+(scale|mode|key)$/, '');
    if (!s) return null;
    let m = s.match(/^0?(\d{1,2})\s*([ab])$/);
    if (m) {
      const num = +m[1];
      return num >= 1 && num <= 12 ? camelotToKey(num, m[2].toUpperCase()) : null;
    }
    m = s.match(/^(\d{1,2})\s*([dm])$/); // Open Key (Traktor)
    if (m) {
      const num = +m[1];
      return num >= 1 && num <= 12 ? camelotToKey((num + 6) % 12 + 1, m[2] === 'd' ? 'B' : 'A') : null;
    }
    m = s.match(/^([a-g])\s*(#|b|-?sharp|-?flat)?\s*-?\s*([a-z]*)$/);
    if (!m) return null;
    let pc = LETTER_PC[m[1].toUpperCase()];
    const acc = m[2] || '';
    if (acc.includes('#') || acc.includes('sharp')) pc += 1;
    else if (acc === 'b' || acc.includes('flat')) pc -= 1;
    const mode = MODE_ALIASES[m[3]];
    if (!mode) return null;
    return { tonic: (pc + 12) % 12, mode };
  }

  /** "Am", "Bbm", "F#", "Ab mixolydian", "E♭ Dorian", "8A", "5m", "3B (A♭ Mixolydian)" → {tonic, mode} | null */
  function parseKey(input) {
    if (input == null) return null;
    let s = String(input).replace(/♭/g, 'b').replace(/♯/g, '#').replace(/–/g, '-').trim();
    if (!s) return null;
    const paren = s.match(/\(([^)]*)\)/);
    if (paren) {
      const inner = parseSimple(paren[1]);
      if (inner) return inner;
      s = s.replace(/\([^)]*\)/g, '');
    }
    return parseSimple(s);
  }

  /* ---------- compatibility ---------- */

  // Relation kinds, smoothest first. `tier` is the strictness level that allows it.
  const RELATIONS = {
    same:      { label: 'Same key',            tier: 0, score: 100, cls: 'rel-same' },
    relative:  { label: 'Shared scale',        tier: 0, score: 92,  cls: 'rel-relative' },
    neighbor:  { label: 'Neighbor',            tier: 1, score: 80,  cls: 'rel-neighbor' },
    parallel:  { label: 'Parallel · same root', tier: 2, score: 64, cls: 'rel-parallel' },
    twostep:   { label: 'Two steps',           tier: 2, score: 55,  cls: 'rel-stretch' },
    lift:      { label: 'Key lift',            tier: 2, score: 48,  cls: 'rel-stretch' },
    clash:     { label: 'Clash',               tier: 9, score: 15,  cls: 'rel-clash' },
    unknown:   { label: 'Key unknown',         tier: 1, score: 50,  cls: 'rel-unknown' },
  };

  const hasKey = s => s && s.tonic != null && s.mode;

  /** How the key of `b` follows the key of `a`. */
  function keyRelation(a, b) {
    if (!hasKey(a) || !hasKey(b)) return { kind: 'unknown', ...RELATIONS.unknown, detail: 'Add a key to compare' };
    const ca = camelot(a.tonic, a.mode), cb = camelot(b.tonic, b.mode);
    const d = ((cb.num - ca.num + 18) % 12) - 6; // −6..5, signed steps around the wheel
    const sa = pcSet(a.tonic, a.mode);
    const shared = [...pcSet(b.tonic, b.mode)].filter(p => sa.has(p)).length;
    const notes = `${shared}/7 notes shared`;
    const up = (b.tonic - a.tonic + 12) % 12;
    let kind, detail;
    if (a.tonic === b.tonic && a.mode === b.mode) { kind = 'same'; detail = 'Identical key — mix anywhere'; }
    else if (d === 0) {
      kind = 'relative';
      detail = `${MODE[a.mode].name} → ${MODE[b.mode].name} on the same 7 notes`;
    }
    else if (Math.abs(d) === 1) {
      kind = 'neighbor';
      detail = d > 0 ? `+1 on the wheel · energy up · ${notes}` : `−1 on the wheel · calmer · ${notes}`;
    }
    else if (a.tonic === b.tonic) { kind = 'parallel'; detail = `${MODE[a.mode].name} → ${MODE[b.mode].name}, same root · ${notes}`; }
    else if (Math.abs(d) === 2) { kind = 'twostep'; detail = `${d > 0 ? '+2' : '−2'} on the wheel · ${notes}`; }
    else if (a.mode === b.mode && (up === 1 || up === 2)) {
      kind = 'lift';
      detail = `Up a ${up === 1 ? 'semitone' : 'whole tone'} — a classic key-change lift`;
    }
    else { kind = 'clash'; detail = notes; }
    const rel = RELATIONS[kind];
    let label = rel.label;
    if (kind === 'neighbor') label = d > 0 ? 'Neighbor +1' : 'Neighbor −1';
    if (kind === 'relative' && MODE[a.mode].side !== MODE[b.mode].side) label = 'Relative ' + (MODE[b.mode].side === 'B' ? 'major side' : 'minor side');
    const score = kind === 'clash' ? Math.max(0, shared * 5 - 5) : rel.score;
    return { kind, ...rel, label, detail, score, shared, steps: d };
  }

  /** How far `b` must be stretched to sit at `a`'s tempo. Considers half/double time. */
  function tempoMatch(a, b, allowHalfDouble = true) {
    if (!a?.bpm || !b?.bpm) return { known: false, score: 50, label: 'BPM unknown', pct: null };
    const ratios = allowHalfDouble ? [1, 2, 0.5] : [1];
    let best = null;
    for (const r of ratios) {
      const pct = (a.bpm / (b.bpm * r) - 1) * 100;
      const abs = Math.abs(pct);
      let score = abs <= 1 ? 100 : abs <= 3 ? 100 - (abs - 1) * 10 : abs <= 6 ? 80 - (abs - 3) * 10 : abs <= 10 ? 50 - (abs - 6) * 10 : 0;
      if (r !== 1) score -= 10;
      if (!best || score > best.score) best = { r, pct, score: Math.max(0, score) };
    }
    const semis = 12 * Math.log2(1 + best.pct / 100);
    const pctText = Math.abs(best.pct) < 0.05 ? 'Same tempo' : `${best.pct >= 0 ? '+' : '−'}${Math.abs(best.pct).toFixed(1)}% tempo`;
    return {
      known: true,
      ratio: best.r,
      pct: best.pct,
      score: Math.round(best.score),
      semitones: semis,
      label: (best.r === 2 ? 'Double-time · ' : best.r === 0.5 ? 'Half-time · ' : '') + pctText,
      keyLock: Math.abs(semis) >= 0.5,
    };
  }

  /** Combined transition from a → b. */
  function transition(a, b, opts = {}) {
    const key = keyRelation(a, b);
    const tempo = tempoMatch(a, b, opts.halfDouble !== false);
    let score = 0.55 * key.score + 0.45 * tempo.score;
    if (opts.energy && a.energy && b.energy) {
      const de = b.energy - a.energy;
      if (opts.energy === 'up') score += de > 0 ? 6 : de < 0 ? -10 : 0;
      if (opts.energy === 'down') score += de < 0 ? 6 : de > 0 ? -10 : 0;
      if (opts.energy === 'hold') score += de === 0 ? 6 : -Math.abs(de) * 4;
    }
    score = Math.max(0, Math.min(100, Math.round(score)));
    const grade = score >= 85 ? 'great' : score >= 68 ? 'good' : score >= 50 ? 'ok' : 'rough';
    return { key, tempo, score, grade };
  }

  /** Greedy smoothest-path ordering, starting from the first song. */
  function smartOrder(list, opts = {}) {
    if (list.length < 3) return list.slice();
    const rest = list.slice(1);
    const out = [list[0]];
    while (rest.length) {
      const cur = out[out.length - 1];
      let bi = 0, bs = -1;
      rest.forEach((s, i) => {
        const sc = transition(cur, s, opts).score;
        if (sc > bs) { bs = sc; bi = i; }
      });
      out.push(rest.splice(bi, 1)[0]);
    }
    return out;
  }

  return {
    MODES, MODE, RELATIONS, HOOK_TONICS,
    tonicName, keyName, camelot, camelotToKey, signatureOf, scaleNotes, family, hooktheoryUrl,
    parseKey, keyRelation, tempoMatch, transition, smartOrder, hasKey,
  };
})();
