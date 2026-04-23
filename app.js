let data = null;
let teamsData = null;
let scheduleData = null;
let initialLoadDone = false;
let previousLeaderboard = null;
let countdownInterval = null;

// === Theme Toggle ===
const themeToggle = document.getElementById('theme-toggle');
const savedTheme = localStorage.getItem('fipl-theme') || 'dark';
document.documentElement.setAttribute('data-theme', savedTheme);
themeToggle.textContent = savedTheme === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19';
themeToggle.addEventListener('click', () => {
  const current = document.documentElement.getAttribute('data-theme');
  const next = current === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', next);
  localStorage.setItem('fipl-theme', next);
  themeToggle.textContent = next === 'dark' ? '\u2600\uFE0F' : '\uD83C\uDF19';
  renderTitleRace();
});

// === Team Logos ===
const TEAM_LOGOS = {
  CSK: 'https://g.cricapi.com/iapi/135-637852956181378533.png?w=48',
  DC: 'https://g.cricapi.com/iapi/148-637874596301457910.png?w=48',
  GT: 'https://g.cricapi.com/iapi/172-637852957798476823.png?w=48',
  KKR: 'https://g.cricapi.com/iapi/206-637852958714346149.png?w=48',
  LSG: 'https://g.cricapi.com/iapi/215-637876059669009476.png?w=48',
  MI: 'https://g.cricapi.com/iapi/226-637852956375593901.png?w=48',
  PBKS: 'https://g.cricapi.com/iapi/247-637852956959778791.png?w=48',
  RCB: 'https://g.cricapi.com/iapi/21439-638468478038395955.jpg?w=48',
  RR: 'https://g.cricapi.com/iapi/251-637852956607161886.png?w=48',
  SRH: 'https://g.cricapi.com/iapi/279-637852957609490368.png?w=48',
};

function teamLogo(abbr, size) {
  const sz = size || 16;
  const url = TEAM_LOGOS[abbr];
  if (!url) return '';
  return `<img src="${url}" alt="${abbr}" class="team-logo" style="width:${sz}px;height:${sz}px">`;
}

function iplBadge(abbr) {
  if (!abbr) return '';
  return `${teamLogo(abbr, 14)}<span class="ipl-badge">${abbr}</span>`;
}

const TEAM_FULL_TO_ABBR = {
  'Chennai Super Kings': 'CSK', 'Mumbai Indians': 'MI', 'Royal Challengers Bengaluru': 'RCB',
  'Kolkata Knight Riders': 'KKR', 'Sunrisers Hyderabad': 'SRH', 'Rajasthan Royals': 'RR',
  'Delhi Capitals': 'DC', 'Punjab Kings': 'PBKS', 'Gujarat Titans': 'GT', 'Lucknow Super Giants': 'LSG',
};

function matchTeams(matchName) {
  const result = [];
  for (const [full, abbr] of Object.entries(TEAM_FULL_TO_ABBR)) {
    if (matchName.includes(full)) result.push(abbr);
  }
  return result;
}

// === Data Loading ===
async function loadData() {
  try {
    const cacheBust = `?t=${Date.now()}`;
    const [scoresRes, teamsRes, scheduleRes] = await Promise.all([
      fetch('data/scores.json' + cacheBust),
      fetch('data/teams.json' + cacheBust),
      fetch('data/schedule.json' + cacheBust),
    ]);
    if (scoresRes.ok) data = await scoresRes.json();
    if (teamsRes.ok) teamsData = await teamsRes.json();
    if (scheduleRes.ok) scheduleData = await scheduleRes.json();
  } catch (e) {
    console.error('Failed to load data:', e);
  }

  if (data) {
    // Snapshot leaderboard for animation on refresh
    if (initialLoadDone && data.leaderboard) {
      previousLeaderboard = {};
      for (const entry of data.leaderboard) {
        previousLeaderboard[entry.team] = entry.top11Points;
      }
    }

    renderLastUpdated();
    renderCurrentMatch();
    renderLeaderboard();
    renderAllMatches();
    renderTopScorers();
    renderTitleRace();
    renderH2H();
    renderBestXI();
    renderHeatmap();
    renderReportCard();

    if (!initialLoadDone) initialLoadDone = true;
  } else {
    document.getElementById('leaderboard').querySelector('tbody').innerHTML =
      '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-muted)">No scores yet. Data will appear once matches begin.</td></tr>';
    renderAllMatches();
    renderTitleRace();
  }
}

function renderLastUpdated() {
  const el = document.getElementById('last-updated');
  if (data.lastUpdated) {
    const d = new Date(data.lastUpdated);
    el.textContent = `Last updated: ${d.toLocaleString()}`;
  }
}

// === Countdown Timer ===
function renderCurrentMatch() {
  const el = document.getElementById('current-match');

  if (data.currentMatch) {
    el.classList.remove('hidden', 'countdown-mode');
    const m = data.currentMatch;
    const teams = matchTeams(m.name);

    // Header bar (always visible, clickable to toggle)
    let headerText = '';
    if (teams.length === 2) {
      headerText = `${teamLogo(teams[0], 20)} ${teams[0]} vs ${teams[1]} ${teamLogo(teams[1], 20)}`;
    } else {
      headerText = m.name;
    }
    let scoreSnippet = '';
    if (m.score) {
      scoreSnippet = m.score.map(s => `${s.r}/${s.w}`).join(' &middot; ');
    }

    let html = `<div class="current-match-header" onclick="document.getElementById('current-match').classList.toggle('collapsed')">`;
    html += `<h3><span class="live-dot"></span>${headerText}</h3>`;
    html += `<span class="current-match-summary">${scoreSnippet}</span>`;
    html += `<span class="collapse-chevron"></span>`;
    html += `</div>`;

    // Collapsible body
    html += `<div class="current-match-body">`;
    html += `<p style="font-size:0.8rem;color:var(--text-muted)">${m.venue || ''}</p>`;
    html += `<p style="font-size:0.8rem;color:var(--text-secondary)">${m.status}</p>`;
    if (m.score) {
      for (const s of m.score) {
        html += `<p class="score-line">${s.inning}: ${s.r}/${s.w} (${s.o} ov)</p>`;
      }
    }
    const matchEntry = data.matchHistory?.find(mh => mh.matchId === m.matchId);
    if (matchEntry?.scorecard) {
      html += renderCombinedScorecard(matchEntry);
    }
    html += `</div>`;

    el.innerHTML = html;

    // Auto-expand on Matches tab, collapse on others
    const activeView = document.querySelector('.nav-btn.active')?.dataset.view;
    if (activeView === 'all-matches') {
      el.classList.remove('collapsed');
    } else {
      el.classList.add('collapsed');
    }

    if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
    return;
  }

  // No live match — check for countdown
  if (!scheduleData || scheduleData.length === 0) {
    el.classList.add('hidden');
    return;
  }

  const now = new Date();
  const completedDates = new Set((data?.matchHistory || []).map(m => m.date));
  const nextMatch = scheduleData.find(m => {
    if (completedDates.has(m.date)) return false;
    const [h, min] = m.time.split(':').map(Number);
    const matchTime = new Date(`${m.date}T${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}:00+05:30`);
    return matchTime > now;
  });

  if (!nextMatch) {
    el.classList.add('hidden');
    return;
  }

  const [h, min] = nextMatch.time.split(':').map(Number);
  const matchTime = new Date(`${nextMatch.date}T${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}:00+05:30`);
  const diffMs = matchTime - now;

  if (diffMs > 24 * 60 * 60 * 1000) {
    el.classList.add('hidden');
    return;
  }

  el.classList.remove('hidden');
  el.classList.add('countdown-mode');

  function updateCountdown() {
    const remaining = matchTime - new Date();
    if (remaining <= 0) {
      el.classList.add('hidden');
      if (countdownInterval) { clearInterval(countdownInterval); countdownInterval = null; }
      return;
    }
    const hrs = Math.floor(remaining / 3600000);
    const mins = Math.floor((remaining % 3600000) / 60000);
    const secs = Math.floor((remaining % 60000) / 1000);
    const timeStr = hrs > 0 ? `${hrs}h ${mins}m ${secs}s` : `${mins}m ${secs}s`;
    el.innerHTML = `
      <p class="countdown-text">Next match in ${timeStr}</p>
      <p class="countdown-match">${teamLogo(nextMatch.home, 20)} ${nextMatch.home} vs ${nextMatch.away} ${teamLogo(nextMatch.away, 20)}</p>
      <p style="font-size:0.75rem;color:var(--text-muted);margin-top:4px">${nextMatch.venue}</p>
    `;
  }

  updateCountdown();
  if (countdownInterval) clearInterval(countdownInterval);
  countdownInterval = setInterval(updateCountdown, 1000);
}

// === Helper: compute per-team match total ===
function computeTeamMatchTotal(teamMeta, matchPlayerScores) {
  let total = 0;
  for (const p of teamMeta.players) {
    const s = matchPlayerScores[p.name];
    if (s) {
      const mult = p.name === teamMeta.captain ? 2 : p.name === teamMeta.viceCaptain ? 1.5 : 1;
      total += Math.round(s.total * mult);
    }
  }
  return total;
}

// Mirrors scripts/update-scores-espn.js buildOutput top-11 selection (cumulative raw × C/VC).
const REQUIRED_ROLES_TOP11 = ['Opener', 'Batsman', 'Wicket Keeper', 'Fast Bowler', 'All-Rounder', 'Spinner'];

function computeTop11PointsForTeam(teamMeta, rawTotalsByName) {
  const playerList = teamMeta.players.map(p => {
    const raw = rawTotalsByName[p.name] || 0;
    let mult = 1;
    if (p.name === teamMeta.captain) mult = 2;
    else if (p.name === teamMeta.viceCaptain) mult = 1.5;
    const effectivePoints = Math.round(raw * mult);
    return { name: p.name, role: p.role, effectivePoints };
  });
  playerList.sort((a, b) => b.effectivePoints - a.effectivePoints);
  const selected = new Set();
  for (const role of REQUIRED_ROLES_TOP11) {
    const best = playerList.find(pl => pl.role === role && !selected.has(pl.name));
    if (best) selected.add(best.name);
  }
  for (const pl of playerList) {
    if (selected.size >= 11) break;
    if (!selected.has(pl.name)) selected.add(pl.name);
  }
  let sum = 0;
  for (const pl of playerList) {
    if (selected.has(pl.name)) sum += pl.effectivePoints;
  }
  return sum;
}

// Matches buildOutput totalPointsAll: sum over roster of round(cumulative_raw * mult), not sum of per-match rounded squad totals.
function computeTotalPointsAllStyle(teamMeta, rawTotalsByName) {
  let sum = 0;
  for (const p of teamMeta.players) {
    const raw = rawTotalsByName[p.name] || 0;
    let mult = 1;
    if (p.name === teamMeta.captain) mult = 2;
    else if (p.name === teamMeta.viceCaptain) mult = 1.5;
    sum += Math.round(raw * mult);
  }
  return sum;
}

// Same order as `scores.json` / buildOutput (do not re-sort by date: ties would diverge from leaderboard).
function matchHistoryInOrder(matches) {
  return [...(matches || [])];
}

// ─── Bar Chart Race (smooth canvas animation) ────────────────────────────────

const TITLE_RACE_COLORS = [
  '#60a5fa', '#f472b6', '#4ade80', '#fbbf24', '#a78bfa',
  '#f87171', '#22d3ee', '#fb923c', '#c084fc', '#2dd4bf',
];

// State
let titleRaceControlsBound = false;
let titleRaceSeries = null;       // { matchMeta, frames: [{team,points,color}[]] }
let titleRaceRafId = null;        // rAF handle
let titleRaceIsPlaying = false;

// Animation state (all in "frame-space" where 1 unit = one match step)
let trAnimPos = 0;               // current animated position (fractional frame index)
let trAnimTarget = 0;            // target position
let trLastTs = null;             // timestamp of last rAF tick
let trSpeedFps = 1;              // frames-per-second advance speed during playback

// Per-team current displayed values (interpolated)
let trBarState = {};             // { teamName: { y, value } }  — y in [0..N-1], value in points

function getTitleRaceMode() {
  const el = document.querySelector('input[name="title-race-mode"]:checked');
  return el && el.value === 'all' ? 'all' : 'top11';
}

function getTitleRaceSpeedFps() {
  const speedEl = document.getElementById('title-race-speed');
  const speed = Number(speedEl?.value || '1');
  // speed knob: 0.5 → 0.5 fps, 1 → 1 fps, 2 → 2 fps
  return speed;
}

function titleRaceStepLabel(index) {
  if (!titleRaceSeries) return '';
  const m = titleRaceSeries.matchMeta[Math.round(index)];
  if (!m || Math.round(index) === 0) return 'Season start';
  const i = Math.round(index);
  return `Match ${i}: ${m.name || ''}${m.date ? ' (' + m.date + ')' : ''}`;
}

function buildTitleRaceSeries(mode) {
  const allHistory = matchHistoryInOrder(data?.matchHistory);
  const teams = teamsData?.teams || [];

  // Only include matches that have actual player scores — a match entry with
  // no scored players means it's a live/stub entry and its data is carried by
  // data.leaderboard instead.  Excluding it prevents the last two frames from
  // showing identical values.
  const history = allHistory.filter(m => Object.keys(m.playerScores || {}).length > 0);
  const n = history.length;

  // matchMeta[0] = season start, matchMeta[k] = after match k
  const matchMeta = [{ name: 'Season start', date: '' }];
  for (let i = 0; i < n; i++) {
    matchMeta.push({ name: history[i].name || '', date: history[i].date || '' });
  }

  const rawByTeam = {};
  for (const t of teams) {
    rawByTeam[t.name] = {};
    for (const p of t.players) rawByTeam[t.name][p.name] = 0;
  }

  // frames[f] = array of { team, points, color } sorted desc by points at frame f
  const frames = [];
  const teamColors = {};
  teams.forEach((t, idx) => { teamColors[t.name] = TITLE_RACE_COLORS[idx % TITLE_RACE_COLORS.length]; });

  // Frame 0: all zero
  frames.push(teams.map(t => ({ team: t.name, points: 0, color: teamColors[t.name] }))
    .sort((a, b) => b.points - a.points));

  for (let k = 0; k < n; k++) {
    const match = history[k];
    const ps = match.playerScores || {};
    for (const team of teams) {
      const rawMap = rawByTeam[team.name];
      for (const p of team.players) {
        const s = ps[p.name];
        if (s) rawMap[p.name] += s.total;
      }
    }
    const snapshot = teams.map(t => ({
      team: t.name,
      color: teamColors[t.name],
      points: mode === 'all'
        ? computeTotalPointsAllStyle(t, rawByTeam[t.name])
        : computeTop11PointsForTeam(t, rawByTeam[t.name]),
    })).sort((a, b) => b.points - a.points);
    frames.push(snapshot);
  }

  // Snap the last frame to data.leaderboard — the authoritative server totals.
  // This corrects any minor rounding drift and also handles the case where the
  // newest match's scores are reflected in leaderboard but not yet in
  // matchHistory (e.g. still marked as currentMatch on the server).
  if (data?.leaderboard?.length) {
    const lbMap = {};
    for (const entry of data.leaderboard) {
      lbMap[entry.team] = mode === 'all' ? entry.totalPointsAll : entry.top11Points;
    }

    // Check if leaderboard totals differ meaningfully from our last frame —
    // if so, the leaderboard includes a match we don't have in history yet,
    // so append an extra frame for it.
    const lastFrame = frames[frames.length - 1];
    const lbFrame = lastFrame.map(bar => ({
      ...bar,
      points: lbMap[bar.team] ?? bar.points,
    })).sort((a, b) => b.points - a.points);

    const hasExtraMatch = lbFrame.some((bar, i) => bar.points !== lastFrame[i]?.points || bar.team !== lastFrame[i]?.team);

    if (hasExtraMatch) {
      // Label it as the match that's in leaderboard but not history
      const extraMatchName = data.currentMatch?.name || allHistory[allHistory.length - 1]?.name || '';
      const extraMatchDate = data.currentMatch?.date || allHistory[allHistory.length - 1]?.date || '';
      matchMeta.push({ name: extraMatchName, date: extraMatchDate });
      frames.push(lbFrame);
    } else {
      // Just snap values in place to fix rounding
      for (const bar of lastFrame) {
        if (lbMap[bar.team] !== undefined) bar.points = lbMap[bar.team];
      }
      lastFrame.sort((a, b) => b.points - a.points);
    }
  }

  return { matchMeta, frames };
}

// ── Canvas renderer ──────────────────────────────────────────────────────────
function getTitleRaceCanvas() { return document.getElementById('title-race-chart'); }

function easeInOut(t) {
  // smooth-step
  return t * t * (3 - 2 * t);
}

function lerpBarState(frameA, frameB, t) {
  // Build a map for each frame
  const mapA = {}, mapB = {};
  frameA.forEach((d, i) => { mapA[d.team] = { rank: i, points: d.points, color: d.color }; });
  frameB.forEach((d, i) => { mapB[d.team] = { rank: i, points: d.points, color: d.color }; });

  const teams = frameB.map(d => d.team);
  const et = easeInOut(Math.max(0, Math.min(1, t)));

  return teams.map(name => {
    const a = mapA[name] ?? { rank: mapA[teams[0]]?.rank ?? 0, points: 0 };
    const b = mapB[name];
    return {
      team: name,
      color: b.color,
      rank: a.rank + (b.rank - a.rank) * et,
      points: a.points + (b.points - a.points) * et,
    };
  });
}

function drawTitleRaceFrame(animPos) {
  const canvas = getTitleRaceCanvas();
  if (!canvas || !titleRaceSeries) return;

  const frames = titleRaceSeries.frames;
  const maxFrame = frames.length - 1;
  const clampedPos = Math.max(0, Math.min(animPos, maxFrame));

  const frameFloor = Math.floor(clampedPos);
  const frameA = Math.min(frameFloor, maxFrame);
  const frameB = Math.min(frameFloor + 1, maxFrame);
  const t = clampedPos - frameFloor;

  const bars = (frameA === frameB || t === 0)
    ? frames[frameA].map((d, i) => ({ team: d.team, color: d.color, rank: i, points: d.points }))
    : lerpBarState(frames[frameA], frames[frameB], t);

  // Sort by animated rank for drawing order (so labels don't overlap awkwardly)
  bars.sort((a, b) => a.rank - b.rank);

  const cs = getComputedStyle(document.documentElement);
  const pick = v => (v || '').trim() || '#94a3b8';
  const colorText   = pick(cs.getPropertyValue('--text-secondary'));
  const colorMuted  = pick(cs.getPropertyValue('--text-muted'));
  const colorBg     = pick(cs.getPropertyValue('--bg-card'));
  const colorBorder = pick(cs.getPropertyValue('--border'));

  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth;
  const H = canvas.clientHeight;
  if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
    canvas.width  = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
  }
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);

  const N = bars.length;
  if (N === 0) return;

  const PAD_L = 8;
  const PAD_R = 110; // room for value label
  const PAD_T = 36;
  const PAD_B = 24;
  const rowH = (H - PAD_T - PAD_B) / N;
  const barH = Math.max(6, rowH * 0.62);
  const barGap = (rowH - barH) / 2;

  const maxPoints = Math.max(...frames[maxFrame].map(d => d.points), 1);
  const barMaxW = W - PAD_L - PAD_R - 120; // 120 for team name label

  const LABEL_W = 112;

  // Grid lines
  const gridSteps = 4;
  ctx.save();
  ctx.strokeStyle = colorBorder;
  ctx.lineWidth = 0.5;
  ctx.setLineDash([3, 3]);
  for (let g = 0; g <= gridSteps; g++) {
    const x = PAD_L + LABEL_W + (barMaxW * g / gridSteps);
    ctx.beginPath();
    ctx.moveTo(x, PAD_T - 8);
    ctx.lineTo(x, H - PAD_B);
    ctx.stroke();
    // grid label
    ctx.fillStyle = colorMuted;
    ctx.font = `10px system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(Math.round(maxPoints * g / gridSteps), x, PAD_T - 12);
  }
  ctx.restore();

  // Bars
  bars.forEach(bar => {
    const y = PAD_T + bar.rank * rowH + barGap;
    const w = Math.max(0, (bar.points / maxPoints) * barMaxW);
    const x = PAD_L + LABEL_W;

    // Bar fill with slight gradient
    const grad = ctx.createLinearGradient(x, 0, x + w, 0);
    grad.addColorStop(0, bar.color + 'cc');
    grad.addColorStop(1, bar.color);
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.roundRect
      ? ctx.roundRect(x, y, w, barH, 4)
      : ctx.rect(x, y, w, barH);
    ctx.fill();

    // Team name (left of bar)
    ctx.fillStyle = colorText;
    ctx.font = `bold 12px system-ui, sans-serif`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    const shortName = bar.team.length > 14 ? bar.team.slice(0, 13) + '…' : bar.team;
    ctx.fillText(shortName, x - 8, y + barH / 2);

    // Points value (right of bar)
    ctx.fillStyle = bar.color;
    ctx.font = `bold 12px system-ui, sans-serif`;
    ctx.textAlign = 'left';
    ctx.fillText(Math.round(bar.points) + ' pts', x + w + 8, y + barH / 2);
  });

  // Match label (top centre)
  ctx.fillStyle = colorText;
  ctx.font = `bold 13px system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(titleRaceStepLabel(clampedPos), W / 2, 20);

  // Update slider & standings sidebar
  const slider = document.getElementById('title-race-slider');
  const label  = document.getElementById('title-race-slider-label');
  if (slider) slider.value = String(Math.round(clampedPos));
  if (label)  label.textContent = titleRaceStepLabel(clampedPos);

  const standings = document.getElementById('title-race-standings');
  if (standings) {
    const sorted = [...bars].sort((a, b) => a.rank - b.rank);
    standings.innerHTML = sorted.map((r, rank) => `
      <div class="title-race-standing-item" style="border-left-color:${r.color}">
        <div class="title-race-standing-rank">#${rank + 1}</div>
        <div class="title-race-standing-team">${r.team}</div>
        <div class="title-race-standing-points">${Math.round(r.points)} pts</div>
      </div>
    `).join('');
  }
}

// ── Animation loop ───────────────────────────────────────────────────────────
function titleRaceAnimLoop(ts) {
  if (!titleRaceSeries) return;
  const maxFrame = titleRaceSeries.frames.length - 1;

  if (trLastTs !== null) {
    const dt = Math.min((ts - trLastTs) / 1000, 0.1); // seconds, capped at 100 ms

    if (titleRaceIsPlaying) {
      // Advance target by speed * dt frames
      trAnimTarget = Math.min(trAnimTarget + getTitleRaceSpeedFps() * dt, maxFrame);
    }

    // Smoothly chase target (lerp with fixed decay)
    const diff = trAnimTarget - trAnimPos;
    if (Math.abs(diff) > 0.001) {
      // Use a spring-like approach: move 85% of remaining gap per second
      trAnimPos += diff * Math.min(1, 8 * dt);
    } else {
      trAnimPos = trAnimTarget;
    }
  }
  trLastTs = ts;

  drawTitleRaceFrame(trAnimPos);

  // Stop playing if we've reached the end
  if (titleRaceIsPlaying && trAnimTarget >= maxFrame && Math.abs(trAnimPos - maxFrame) < 0.01) {
    titleRaceIsPlaying = false;
    trAnimPos = maxFrame;
    const playBtn = document.getElementById('title-race-play-btn');
    if (playBtn) playBtn.textContent = 'Play';
  }

  titleRaceRafId = requestAnimationFrame(titleRaceAnimLoop);
}

function startTitleRaceLoop() {
  if (titleRaceRafId) return;
  trLastTs = null;
  titleRaceRafId = requestAnimationFrame(titleRaceAnimLoop);
}

function stopTitleRacePlayback() {
  titleRaceIsPlaying = false;
  const playBtn = document.getElementById('title-race-play-btn');
  if (playBtn) playBtn.textContent = 'Play';
}

function destroyTitleRaceLoop() {
  if (titleRaceRafId) {
    cancelAnimationFrame(titleRaceRafId);
    titleRaceRafId = null;
  }
  titleRaceIsPlaying = false;
}

// ── Main render entry ────────────────────────────────────────────────────────
function renderTitleRace() {
  const canvas = getTitleRaceCanvas();
  if (!canvas) return;

  // Switch canvas from Chart.js mode to plain 2d (destroy old Chart if any)
  if (canvas._chartInstance) {
    canvas._chartInstance.destroy();
    canvas._chartInstance = null;
  }

  if (!titleRaceControlsBound) {
    titleRaceControlsBound = true;

    document.querySelectorAll('input[name="title-race-mode"]').forEach(r => {
      r.addEventListener('change', () => {
        stopTitleRacePlayback();
        rebuildTitleRaceSeries();
      });
    });

    const slider = document.getElementById('title-race-slider');
    if (slider) {
      slider.addEventListener('input', (e) => {
        stopTitleRacePlayback();
        const idx = Number(e.target.value);
        trAnimTarget = idx;
        trAnimPos = idx;
      });
    }

    const playBtn = document.getElementById('title-race-play-btn');
    if (playBtn) {
      playBtn.addEventListener('click', () => {
        if (!titleRaceSeries) return;
        if (titleRaceIsPlaying) {
          stopTitleRacePlayback();
          return;
        }
        const maxFrame = titleRaceSeries.frames.length - 1;
        if (trAnimTarget >= maxFrame) {
          trAnimTarget = 0;
          trAnimPos = 0;
        }
        titleRaceIsPlaying = true;
        playBtn.textContent = 'Pause';
        startTitleRaceLoop();
      });
    }

    const speedEl = document.getElementById('title-race-speed');
    if (speedEl) {
      // speed change takes effect automatically since getTitleRaceSpeedFps() is called each tick
      speedEl.addEventListener('change', () => { /* no-op, handled in loop */ });
    }

    // Keep canvas sized correctly on resize
    const ro = new ResizeObserver(() => {
      if (titleRaceSeries) drawTitleRaceFrame(trAnimPos);
    });
    ro.observe(canvas);
  }

  if (!data || !teamsData?.teams?.length || !data.matchHistory || data.matchHistory.length === 0) {
    destroyTitleRaceLoop();
    titleRaceSeries = null;
    const standings = document.getElementById('title-race-standings');
    const slider    = document.getElementById('title-race-slider');
    const label     = document.getElementById('title-race-slider-label');
    if (standings) standings.innerHTML = '';
    if (slider)  { slider.max = '0'; slider.value = '0'; }
    if (label)   label.textContent = 'Season start';
    return;
  }

  rebuildTitleRaceSeries();
}

function rebuildTitleRaceSeries() {
  const mode = getTitleRaceMode();
  titleRaceSeries = buildTitleRaceSeries(mode);
  const maxFrame = titleRaceSeries.frames.length - 1;

  const slider = document.getElementById('title-race-slider');
  if (slider) { slider.min = '0'; slider.max = String(maxFrame); }

  // Keep current position valid; jump to end on first build
  if (trAnimPos <= 0 && trAnimTarget <= 0) {
    trAnimPos = maxFrame;
    trAnimTarget = maxFrame;
  } else {
    trAnimPos = Math.min(trAnimPos, maxFrame);
    trAnimTarget = Math.min(trAnimTarget, maxFrame);
  }

  startTitleRaceLoop();
  drawTitleRaceFrame(trAnimPos);
}

// === Leaderboard ===
function renderLeaderboard() {
  const tbody = document.getElementById('leaderboard').querySelector('tbody');
  if (!data.leaderboard || data.leaderboard.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-muted)">No data yet</td></tr>';
    return;
  }

  // Match progress
  const matchesPlayed = (data.matchHistory || []).length;
  const totalMatches = scheduleData ? scheduleData.length : 74;
  const pct = Math.round((matchesPlayed / totalMatches) * 100);
  document.getElementById('match-progress').innerHTML = `
    <div class="match-progress">
      <span class="progress-text">${matchesPlayed} of ${totalMatches} matches played</span>
      <div class="progress-bar-track"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
    </div>`;

  // League stats
  const points = data.leaderboard.map(e => e.top11Points).sort((a, b) => a - b);
  const avg = Math.round(points.reduce((a, b) => a + b, 0) / points.length);
  const mid = Math.floor(points.length / 2);
  const median = points.length % 2 === 1 ? points[mid] : Math.round((points[mid - 1] + points[mid]) / 2);
  document.getElementById('league-stats').innerHTML = `
    <div class="league-stats-row">
      <div class="league-stat-box">
        <div class="league-stat-label">Teams</div>
        <div class="league-stat-value">${data.leaderboard.length}</div>
      </div>
      <div class="league-stat-box">
        <div class="league-stat-label">Avg Points</div>
        <div class="league-stat-value">${avg}</div>
      </div>
      <div class="league-stat-box">
        <div class="league-stat-label">Median Points</div>
        <div class="league-stat-value">${median}</div>
      </div>
    </div>`;

  // Player of the Tournament banner
  renderPOTBanner();

  // Captain Scorecard
  renderCaptainScorecard();

  // Compute last match scores + per-match history for form
  const lastMatch = data.matchHistory?.[data.matchHistory.length - 1];
  const matchHistory = data.matchHistory || [];
  const teamMatchTotals = {};
  if (teamsData) {
    for (const team of teamsData.teams) {
      teamMatchTotals[team.name] = [];
      for (const match of matchHistory) {
        teamMatchTotals[team.name].push(computeTeamMatchTotal(team, match.playerScores || {}));
      }
    }
  }

  const medals = ['\uD83E\uDD47', '\uD83E\uDD48', '\uD83E\uDD49'];

  tbody.innerHTML = data.leaderboard.map((entry, i) => {
    const rankClass = i < 3 ? `rank-${i + 1}` : '';
    const rankDisplay = i < 3 ? medals[i] : `${i + 1}`;

    // IPL logo strip
    const teamMeta = teamsData?.teams?.find(t => t.name === entry.team);
    const iplTeams = teamMeta ? [...new Set(teamMeta.players.map(p => p.iplTeam).filter(Boolean))] : [];
    const logoStrip = iplTeams.length > 0
      ? `<div class="team-logos-strip">${iplTeams.map(t => teamLogo(t, 16)).join('')}</div>`
      : '';

    // Form: last 3 match scores as colored bars
    const matchTotals = teamMatchTotals[entry.team] || [];
    const recentTotals = matchTotals.slice(-3);
    const allMatchAvg = matchTotals.length > 0 ? matchTotals.reduce((a, b) => a + b, 0) / matchTotals.length : 0;
    const maxMatchScore = Math.max(...matchTotals, 1);

    const formBars = recentTotals.map(score => {
      const height = Math.max(4, Math.round((score / maxMatchScore) * 20));
      const color = score >= allMatchAvg * 1.1 ? 'var(--positive)' : score >= allMatchAvg * 0.9 ? 'var(--captain)' : 'var(--negative)';
      return `<div class="form-bar" style="height:${height}px;background:${color}" title="${score}"></div>`;
    }).join('');

    // Momentum arrow
    let momentum = '';
    if (matchTotals.length >= 2) {
      const lastScore = matchTotals[matchTotals.length - 1];
      const ratio = allMatchAvg > 0 ? lastScore / allMatchAvg : 1;
      if (ratio > 1.2) momentum = `<span class="momentum-arrow" style="color:var(--positive)">\u2191</span>`;
      else if (ratio > 1.05) momentum = `<span class="momentum-arrow" style="color:var(--positive)">\u2197</span>`;
      else if (ratio >= 0.95) momentum = `<span class="momentum-arrow" style="color:var(--text-muted)">\u2192</span>`;
      else if (ratio >= 0.8) momentum = `<span class="momentum-arrow" style="color:var(--captain)">\u2198</span>`;
      else momentum = `<span class="momentum-arrow" style="color:var(--negative)">\u2193</span>`;
    }

    // Last match score
    const lastMatchScore = lastMatch && teamMeta ? computeTeamMatchTotal(teamMeta, lastMatch.playerScores || {}) : '-';

    // Gap
    const gap = i === 0 ? '-' : `${entry.top11Points - data.leaderboard[i - 1].top11Points}`;

    return `<tr class="${rankClass}" onclick="showTeam('${entry.team}')">
      <td class="rank-cell">${rankDisplay}</td>
      <td class="team-cell">${entry.team}${logoStrip}</td>
      <td class="hide-mobile"><div class="form-cell">${formBars}${momentum}</div></td>
      <td class="points-cell">${entry.top11Points}</td>
      <td class="last-match-cell">${lastMatchScore}</td>
      <td class="gap-cell hide-mobile">${gap}</td>
      <td class="points-cell hide-mobile" style="opacity:0.6">${entry.totalPointsAll}</td>
    </tr>`;
  }).join('');

  // Animate numbers on refresh
  if (initialLoadDone && previousLeaderboard) {
    tbody.querySelectorAll('tr').forEach(tr => {
      const teamName = tr.querySelector('.team-cell')?.textContent?.split('\n')?.[0]?.trim();
      if (teamName && previousLeaderboard[teamName] !== undefined) {
        const pointsCell = tr.querySelector('.points-cell');
        if (pointsCell) {
          const oldVal = previousLeaderboard[teamName];
          const newVal = parseInt(pointsCell.textContent);
          if (oldVal !== newVal) {
            pointsCell.classList.add('updated');
            animateNumber(pointsCell, oldVal, newVal);
            pointsCell.addEventListener('animationend', () => pointsCell.classList.remove('updated'), { once: true });
          }
        }
      }
    });
  }
}

function animateNumber(el, from, to, duration) {
  duration = duration || 600;
  const start = performance.now();
  const step = (now) => {
    const pct = Math.min((now - start) / duration, 1);
    el.textContent = Math.round(from + (to - from) * pct);
    if (pct < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

// === Player of the Tournament Banner ===
function renderPOTBanner() {
  const container = document.getElementById('pot-banner');
  if (!data?.matchHistory || !teamsData) { container.innerHTML = ''; return; }

  const playerFantasyTeamMap = {};
  const playerIplTeamMap = {};
  for (const team of teamsData.teams) {
    for (const p of team.players) {
      playerFantasyTeamMap[p.name] = team.name;
      playerIplTeamMap[p.name] = p.iplTeam || '';
    }
  }

  const totals = {};
  for (const match of data.matchHistory) {
    for (const [name, s] of Object.entries(match.playerScores || {})) {
      if (!playerFantasyTeamMap[name]) continue;
      totals[name] = (totals[name] || 0) + s.total;
    }
  }

  const entries = Object.entries(totals);
  if (entries.length === 0) { container.innerHTML = ''; return; }
  const [bestName, bestPts] = entries.reduce((a, b) => b[1] > a[1] ? b : a);

  container.innerHTML = `
    <div class="pot-banner">
      <div>
        <div class="pot-label">Player of the Tournament</div>
        <div class="pot-name">${bestName} ${iplBadge(playerIplTeamMap[bestName])}</div>
        <div class="pot-manager">${playerFantasyTeamMap[bestName]}'s team</div>
      </div>
      <div class="pot-points">${bestPts} pts</div>
    </div>`;
}

// === Captain Scorecard ===
function renderCaptainScorecard() {
  const container = document.getElementById('captain-scorecard');
  if (!data?.matchHistory || !teamsData) { container.innerHTML = ''; return; }

  const captains = teamsData.teams.map(team => {
    const capName = team.captain;
    let total = 0;
    for (const match of data.matchHistory) {
      const s = match.playerScores?.[capName];
      if (s) total += s.total;
    }
    return { manager: team.name, captain: capName, iplTeam: team.players.find(p => p.name === capName)?.iplTeam || '', rawPts: total, effectivePts: total * 2 };
  }).sort((a, b) => b.rawPts - a.rawPts);

  container.innerHTML = `
    <h2 style="margin-top:20px">Captains</h2>
    <div class="captain-grid">
      ${captains.map((c, i) => `<div class="captain-card${i === 0 ? ' captain-best' : ''}">
        <div class="captain-card-name">${c.captain} ${iplBadge(c.iplTeam)}</div>
        <div class="captain-card-manager">${c.manager}</div>
        <div class="captain-card-pts">${c.rawPts} <span class="captain-card-mult">(2x = ${c.effectivePts})</span></div>
      </div>`).join('')}
    </div>`;
}

// === Team Detail ===
function showTeam(teamName) {
  const detail = data.teamDetails[teamName];
  if (!detail) return;

  const teamMeta = teamsData?.teams?.find(t => t.name === teamName);

  allSections.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('hidden', id !== 'team-detail');
  });
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  document.getElementById('team-name').textContent = teamName;

  // Points breakdown
  const totalBat = detail.players.reduce((s, p) => s + p.batting, 0);
  const totalBowl = detail.players.reduce((s, p) => s + p.bowling, 0);
  const totalField = detail.players.reduce((s, p) => s + p.fielding, 0);
  const totalRaw = totalBat + totalBowl + totalField;
  const pctBat = totalRaw > 0 ? Math.round((totalBat / totalRaw) * 100) : 0;
  const pctBowl = totalRaw > 0 ? Math.round((totalBowl / totalRaw) * 100) : 0;
  const pctField = 100 - pctBat - pctBowl;

  // Bench waste
  const benchWaste = detail.totalPointsAll - detail.top11Points;

  document.getElementById('team-summary').innerHTML = `
    <div class="stat-box">
      <div class="label">Top 11 Points</div>
      <div class="value">${detail.top11Points}</div>
    </div>
    <div class="stat-box">
      <div class="label">All Players</div>
      <div class="value">${detail.totalPointsAll}</div>
    </div>
    <div class="stat-box">
      <div class="label">Captain</div>
      <div class="value" style="font-size:0.9rem;color:var(--captain)">${teamMeta?.captain || '-'}</div>
    </div>
    <div class="stat-box">
      <div class="label">Vice Captain</div>
      <div class="value" style="font-size:0.9rem;color:var(--vice-captain)">${teamMeta?.viceCaptain || '-'}</div>
    </div>
    <div class="stat-box">
      <div class="label">Bench Waste</div>
      <div class="value" style="font-size:1rem;color:var(--negative)">${benchWaste > 0 ? '+' : ''}${benchWaste} pts</div>
    </div>
    <div class="stat-box" style="min-width:200px">
      <div class="label">Points Breakdown</div>
      <div class="breakdown-bar">
        <div class="breakdown-seg breakdown-bat" style="width:${pctBat}%" title="Batting ${totalBat}">${pctBat > 10 ? pctBat + '%' : ''}</div>
        <div class="breakdown-seg breakdown-bowl" style="width:${pctBowl}%" title="Bowling ${totalBowl}">${pctBowl > 10 ? pctBowl + '%' : ''}</div>
        <div class="breakdown-seg breakdown-field" style="width:${pctField}%" title="Fielding ${totalField}">${pctField > 10 ? pctField + '%' : ''}</div>
      </div>
      <div class="breakdown-legend">
        <span><span class="breakdown-dot breakdown-bat"></span>Bat ${totalBat}</span>
        <span><span class="breakdown-dot breakdown-bowl"></span>Bowl ${totalBowl}</span>
        <span><span class="breakdown-dot breakdown-field"></span>Field ${totalField}</span>
      </div>
    </div>
  `;

  const iplTeamMap = {};
  if (teamMeta) {
    for (const pl of teamMeta.players) {
      iplTeamMap[pl.name] = pl.iplTeam || '';
    }
  }

  const playerMatchData = {};
  for (const match of (data.matchHistory || [])) {
    for (const p of detail.players) {
      const s = match.playerScores[p.name];
      if (s) {
        if (!playerMatchData[p.name]) playerMatchData[p.name] = [];
        playerMatchData[p.name].push({ matchName: match.name, date: match.date, ...s });
      }
    }
  }

  const tbody = document.getElementById('team-players').querySelector('tbody');
  tbody.innerHTML = detail.players.map((p, i) => {
    const rowClass = p.countsInTop11 ? '' : 'not-top11';
    const nameClass = p.multiplier === 2 ? 'captain' : p.multiplier === 1.5 ? 'vice-captain' : '';
    const multLabel = p.multiplier === 2 ? '(C) 2x' : p.multiplier === 1.5 ? '(VC) 1.5x' : '1x';
    const iplTeam = iplTeamMap[p.name] || '';
    const matches = playerMatchData[p.name] || [];
    const hasMatches = matches.length > 0;
    const expandId = `expand-${i}`;

    let matchRows = '';
    if (hasMatches) {
      matchRows = `<tr id="${expandId}" class="player-expand hidden"><td colspan="9">
        <table class="player-match-table">
          <thead><tr><th>Match</th><th>Date</th><th>Bat</th><th>Bowl</th><th>Field</th><th>Pts</th></tr></thead>
          <tbody>${matches.map(m =>
            `<tr>
              <td>${m.matchName}</td>
              <td class="match-date">${m.date}</td>
              <td class="${m.batting > 0 ? 'fp-positive' : m.batting < 0 ? 'fp-negative' : ''}">${m.batting}</td>
              <td class="${m.bowling > 0 ? 'fp-positive' : m.bowling < 0 ? 'fp-negative' : ''}">${m.bowling}</td>
              <td class="${m.fielding > 0 ? 'fp-positive' : m.fielding < 0 ? 'fp-negative' : ''}">${m.fielding}</td>
              <td class="points-cell">${m.total}</td>
            </tr>`
          ).join('')}</tbody>
        </table>
      </td></tr>`;
    }

    return `<tr class="${rowClass}${hasMatches ? ' expandable' : ''}" ${hasMatches ? `onclick="togglePlayerExpand('${expandId}')"` : ''}>
      <td>${i + 1}</td>
      <td class="${nameClass}">${p.name} ${iplBadge(iplTeam)}${hasMatches ? ' <span class="expand-arrow">&#9662;</span>' : ''}</td>
      <td>${p.role}</td>
      <td>${p.batting}</td>
      <td>${p.bowling}</td>
      <td>${p.fielding}</td>
      <td>${p.rawPoints}</td>
      <td>${multLabel}</td>
      <td class="points-cell">${p.effectivePoints}</td>
    </tr>${matchRows}`;
  }).join('');

  renderTeamMatchHistory(teamName, detail);
}

function renderTeamMatchHistory(teamName, detail) {
  const container = document.getElementById('match-history');
  if (!data.matchHistory || data.matchHistory.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted)">No matches played yet</p>';
    return;
  }

  const teamMeta = teamsData?.teams?.find(t => t.name === teamName);
  const playerNames = teamMeta ? teamMeta.players.map(p => p.name) : [];

  container.innerHTML = data.matchHistory.map(match => {
    const relevantPlayers = playerNames
      .filter(name => match.playerScores[name])
      .map(name => {
        const s = match.playerScores[name];
        const p = detail.players.find(pl => pl.name === name);
        const mult = p ? p.multiplier : 1;
        return { name, ...s, mult, effective: Math.round(s.total * mult) };
      })
      .sort((a, b) => b.effective - a.effective);

    if (relevantPlayers.length === 0) return '';

    const matchTotal = relevantPlayers.reduce((sum, p) => sum + p.effective, 0);

    return `<details class="match-card">
      <summary>
        <span>${match.name} <span class="match-date">${match.date || ''}</span></span>
        <span class="points-cell">${matchTotal} pts</span>
      </summary>
      <table>
        <thead><tr><th>Player</th><th>Bat</th><th>Bowl</th><th>Field</th><th>Pts</th></tr></thead>
        <tbody>${relevantPlayers.map(p =>
          `<tr>
            <td>${p.name}${p.mult > 1 ? ` (${p.mult}x)` : ''}</td>
            <td>${p.batting}</td>
            <td>${p.bowling}</td>
            <td>${p.fielding}</td>
            <td class="points-cell">${p.effective}</td>
          </tr>`
        ).join('')}</tbody>
      </table>
    </details>`;
  }).join('');
}

function formatScheduleDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

// === Combined Scorecard + Fantasy Points ===
function renderCombinedScorecard(match) {
  if (!match.scorecard || match.scorecard.length === 0) return '';

  const fantasyMap = {};
  const playerFantasyTeamMap = {};
  if (teamsData) {
    for (const team of teamsData.teams) {
      for (const p of team.players) {
        playerFantasyTeamMap[p.name] = team.name;
      }
    }
  }
  for (const [name, s] of Object.entries(match.playerScores || {})) {
    fantasyMap[name] = s;
  }

  let html = '';
  for (const inn of match.scorecard) {
    html += `<div class="scorecard-innings">`;
    html += `<div class="innings-header">${inn.innings} \u2014 ${inn.runs}/${inn.wickets} (${inn.overs} ov)</div>`;

    if (inn.batting && inn.batting.length > 0) {
      html += `<table class="scorecard-table"><thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th><th class="fantasy-col">FP</th></tr></thead><tbody>`;
      for (const b of inn.batting) {
        const fp = fantasyMap[b.name];
        const fpBat = fp ? fp.batting : null;
        const manager = playerFantasyTeamMap[b.name];
        const fpClass = fpBat !== null ? (fpBat > 0 ? 'fp-positive' : fpBat < 0 ? 'fp-negative' : 'fp-zero') : '';
        const fpCell = fpBat !== null ? `<td class="fantasy-col ${fpClass}" title="${manager}">${fpBat}</td>` : '<td class="fantasy-col"></td>';
        const managerTag = manager ? `<span class="manager-tag">${manager}</span>` : '';
        html += `<tr>
          <td><span class="batter-name">${b.name}</span>${managerTag}<br><span class="dismissal-text">${b.dismissal}</span></td>
          <td>${b.runs}</td><td>${b.balls}</td><td>${b.fours}</td><td>${b.sixes}</td><td>${b.sr}</td>
          ${fpCell}
        </tr>`;
      }
      html += `</tbody></table>`;
    }

    if (inn.bowling && inn.bowling.length > 0) {
      html += `<table class="scorecard-table"><thead><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th><th class="fantasy-col">FP</th></tr></thead><tbody>`;
      for (const b of inn.bowling) {
        const fp = fantasyMap[b.name];
        const fpBowl = fp ? fp.bowling : null;
        const manager = playerFantasyTeamMap[b.name];
        const fpClass = fpBowl !== null ? (fpBowl > 0 ? 'fp-positive' : fpBowl < 0 ? 'fp-negative' : 'fp-zero') : '';
        const fpCell = fpBowl !== null ? `<td class="fantasy-col ${fpClass}" title="${manager}">${fpBowl}</td>` : '<td class="fantasy-col"></td>';
        const managerTag = manager ? `<span class="manager-tag">${manager}</span>` : '';
        html += `<tr>
          <td>${b.name}${managerTag}</td>
          <td>${b.overs}</td><td>${b.maidens}</td><td>${b.runs}</td>
          <td class="${b.wickets >= 3 ? 'wicket-haul' : ''}">${b.wickets}</td>
          <td>${b.economy}</td>
          ${fpCell}
        </tr>`;
      }
      html += `</tbody></table>`;
    }
    html += `</div>`;
  }

  const fieldingEntries = Object.entries(fantasyMap)
    .filter(([_, s]) => s.fielding !== 0)
    .sort((a, b) => b[1].fielding - a[1].fielding);
  if (fieldingEntries.length > 0) {
    html += `<div class="fielding-summary"><span class="fielding-label">Fielding:</span> `;
    html += fieldingEntries.map(([name, s]) => {
      const manager = playerFantasyTeamMap[name];
      return `<span class="fielding-chip" title="${manager || ''}">${name} <span class="fp-positive">+${s.fielding}</span></span>`;
    }).join(' ');
    html += `</div>`;
  }

  return html;
}

// === All Matches ===
function renderAllMatches() {
  const container = document.getElementById('matches-list');
  let html = '';

  const playerFantasyTeamMap = {};
  if (teamsData) {
    for (const team of teamsData.teams) {
      for (const p of team.players) {
        playerFantasyTeamMap[p.name] = team.name;
      }
    }
  }

  const completedDates = new Set();
  const matchHistory = data?.matchHistory || [];
  for (const m of matchHistory) {
    if (m.date) completedDates.add(m.date);
  }

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (scheduleData || []).filter(m => m.date >= today && !completedDates.has(m.date));
  const nextUp = upcoming.slice(0, 10);

  if (nextUp.length > 0) {
    html += '<h3>Upcoming</h3>';
    html += '<div class="schedule-grid">';
    let lastDate = '';
    for (const m of nextUp) {
      const dateLabel = m.date === lastDate ? '' : formatScheduleDate(m.date);
      const [h, min] = m.time.split(':').map(Number);
      const matchUTC = new Date(`${m.date}T${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}:00+05:30`);
      const localTime = matchUTC.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      lastDate = m.date;
      html += `<div class="schedule-row${dateLabel ? '' : ' same-day'}">
        <div class="schedule-date">${dateLabel}</div>
        <div class="schedule-teams">${teamLogo(m.home, 18)} <span class="ipl-badge">${m.home}</span> vs <span class="ipl-badge">${m.away}</span> ${teamLogo(m.away, 18)}</div>
        <div class="schedule-meta">${localTime} &middot; ${m.venue}</div>
      </div>`;
    }
    if (upcoming.length > 10) {
      html += `<p style="color:var(--text-muted);font-size:0.8rem;padding:8px 0">+ ${upcoming.length - 10} more matches</p>`;
    }
    html += '</div>';
  }

  if (matchHistory.length > 0) {
    html += '<h3>Results</h3>';
    html += matchHistory.slice().reverse().map(match => {
      const teams = matchTeams(match.name);
      const scoreLines = (match.score || []).map(s => `${s.inning}: ${s.r}/${s.w} (${s.o} ov)`).join(' | ');

      let headerHtml = match.name;
      if (teams.length === 2) {
        headerHtml = `${teamLogo(teams[0], 18)} ${teams[0]} vs ${teams[1]} ${teamLogo(teams[1], 18)}`;
      }

      const mvps = Object.entries(match.playerScores || {})
        .map(([name, s]) => ({ name, total: s.total, manager: playerFantasyTeamMap[name] || '' }))
        .filter(p => p.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, 3);
      const mvpHtml = mvps.length > 0
        ? `<div class="mvp-strip">${mvps.map((p, i) => `<span class="mvp-chip${i === 0 ? ' mvp-gold' : ''}">${p.name}${p.manager ? ` <span class="manager-tag">${p.manager}</span>` : ''} <span class="fp-positive">${p.total}</span></span>`).join('')}</div>`
        : '';

      // Match Day Winner
      let winnerHtml = '';
      if (teamsData) {
        const teamScores = teamsData.teams.map(team => ({
          name: team.name,
          total: computeTeamMatchTotal(team, match.playerScores || {}),
        })).sort((a, b) => b.total - a.total);
        if (teamScores.length > 0 && teamScores[0].total > 0) {
          winnerHtml = `<div class="match-day-winner"><span class="mdw-label">Match Day Winner:</span> ${teamScores[0].name} <span class="fp-positive">${teamScores[0].total} pts</span></div>`;
        }
      }

      const combinedHtml = renderCombinedScorecard(match);

      return `<details class="match-card">
        <summary>
          <span>${headerHtml} <span class="match-date">${match.date || ''}</span></span>
          <span class="match-date">${match.status || ''}</span>
        </summary>
        <p class="score-line" style="margin:8px 0">${scoreLines}</p>
        ${winnerHtml}
        ${mvpHtml}
        ${combinedHtml}
      </details>`;
    }).join('');
  } else if (nextUp.length === 0) {
    html += '<p style="color:var(--text-muted)">No matches data available</p>';
  }

  container.innerHTML = html;
}

// === Top Scorers ===
let topScorersSortKey = 'total';
let topScorersSortAsc = false;

function getPlayerAggregates() {
  const playerFantasyTeamMap = {};
  const playerIplTeamMap = {};
  const playerRoleMap = {};
  if (teamsData) {
    for (const team of teamsData.teams) {
      for (const p of team.players) {
        playerFantasyTeamMap[p.name] = team.name;
        playerIplTeamMap[p.name] = p.iplTeam || '';
        playerRoleMap[p.name] = p.role || '';
      }
    }
  }

  const totals = {};
  const playerMatches = {};
  for (const match of (data?.matchHistory || [])) {
    for (const [name, s] of Object.entries(match.playerScores || {})) {
      if (!playerFantasyTeamMap[name]) continue;
      if (!totals[name]) totals[name] = { batting: 0, bowling: 0, fielding: 0, total: 0, matches: 0 };
      totals[name].batting += s.batting;
      totals[name].bowling += s.bowling;
      totals[name].fielding += s.fielding;
      totals[name].total += s.total;
      totals[name].matches++;
      if (!playerMatches[name]) playerMatches[name] = [];
      playerMatches[name].push({ matchName: match.name, date: match.date, ...s });
    }
  }

  return { totals, playerMatches, playerFantasyTeamMap, playerIplTeamMap, playerRoleMap };
}

function renderHeroTiles() {
  const container = document.getElementById('hero-tiles');
  if (!data?.matchHistory || !teamsData) { container.innerHTML = ''; return; }

  const { totals, playerFantasyTeamMap, playerIplTeamMap, playerRoleMap } = getPlayerAggregates();
  const players = Object.entries(totals).map(([name, t]) => ({ name, ...t }));

  if (players.length === 0) { container.innerHTML = ''; return; }

  const total = p => p.batting + p.bowling + p.fielding;
  const batRoles = ['Opener', 'Batsman', 'Wicket Keeper'];
  const arRole = 'All-Rounder';
  const batsmen = players.filter(p => batRoles.includes(playerRoleMap[p.name]));
  const allRounders = players.filter(p => playerRoleMap[p.name] === arRole);
  const bowlers = players.filter(p => !batRoles.includes(playerRoleMap[p.name]) && playerRoleMap[p.name] !== arRole);

  const bestBat = batsmen.length > 0 ? batsmen.reduce((a, b) => total(b) > total(a) ? b : a) : null;
  const bestBowl = bowlers.length > 0 ? bowlers.reduce((a, b) => total(b) > total(a) ? b : a) : null;
  const bestAR = allRounders.length > 0 ? allRounders.reduce((a, b) => total(b) > total(a) ? b : a) : null;

  function tile(cls, label, player, pts) {
    return `<div class="hero-tile ${cls}">
      <div class="hero-tile-label">${label}</div>
      <div class="hero-tile-name">${player.name} ${iplBadge(playerIplTeamMap[player.name])}</div>
      <div class="hero-tile-manager">${playerFantasyTeamMap[player.name]}'s team</div>
      <div class="hero-tile-pts">${pts} pts</div>
    </div>`;
  }

  container.innerHTML = `<div class="hero-tiles">
    ${bestBat ? tile('hero-bat', 'Best Batsman', bestBat, total(bestBat)) : ''}
    ${bestBowl ? tile('hero-bowl', 'Best Bowler', bestBowl, total(bestBowl)) : ''}
    ${bestAR ? tile('hero-ar', 'Best All-Rounder', bestAR, total(bestAR)) : ''}
  </div>`;
}

function renderTopScorers() {
  renderHeroTiles();

  const container = document.getElementById('top-scorers-list');
  if (!data?.matchHistory || !teamsData) {
    container.innerHTML = '<p style="color:var(--text-muted)">No data yet</p>';
    return;
  }

  const { totals, playerMatches, playerFantasyTeamMap, playerIplTeamMap } = getPlayerAggregates();

  const players = Object.entries(totals)
    .map(([name, t]) => ({ name, manager: playerFantasyTeamMap[name], ...t }));

  const key = topScorersSortKey;
  const dir = topScorersSortAsc ? 1 : -1;
  if (key === 'name' || key === 'manager') {
    players.sort((a, b) => dir * a[key].localeCompare(b[key]));
  } else {
    players.sort((a, b) => dir * (a[key] - b[key]));
  }

  const columns = [
    { key: 'name', label: 'Player' },
    { key: 'manager', label: 'Manager' },
    { key: 'matches', label: 'M' },
    { key: 'batting', label: 'Bat' },
    { key: 'bowling', label: 'Bowl' },
    { key: 'fielding', label: 'Field' },
    { key: 'total', label: 'Pts' },
  ];

  const headerCells = columns.map(c => {
    const arrow = topScorersSortKey === c.key ? (topScorersSortAsc ? ' \u25B2' : ' \u25BC') : '';
    return `<th class="sortable-th" data-sort="${c.key}">${c.label}${arrow}</th>`;
  }).join('');

  let html = `<table class="top-scorers-table">
    <thead><tr><th>#</th>${headerCells}</tr></thead>
    <tbody>`;
  html += players.map((p, i) => {
    const iplTeam = playerIplTeamMap[p.name] || '';
    const matches = playerMatches[p.name] || [];
    const expandId = `ts-expand-${i}`;
    const matchRows = matches.length > 0
      ? `<tr id="${expandId}" class="player-expand hidden"><td colspan="8">
          <table class="player-match-table">
            <thead><tr><th>Match</th><th>Date</th><th>Bat</th><th>Bowl</th><th>Field</th><th>Pts</th></tr></thead>
            <tbody>${matches.map(m =>
              `<tr>
                <td>${m.matchName}</td>
                <td class="match-date">${m.date}</td>
                <td class="${m.batting > 0 ? 'fp-positive' : m.batting < 0 ? 'fp-negative' : ''}">${m.batting}</td>
                <td class="${m.bowling > 0 ? 'fp-positive' : m.bowling < 0 ? 'fp-negative' : ''}">${m.bowling}</td>
                <td class="${m.fielding > 0 ? 'fp-positive' : m.fielding < 0 ? 'fp-negative' : ''}">${m.fielding}</td>
                <td class="points-cell">${m.total}</td>
              </tr>`
            ).join('')}</tbody>
          </table>
        </td></tr>`
      : '';
    return `<tr class="${i < 3 ? 'top-scorer-' + (i + 1) : ''} expandable" onclick="togglePlayerExpand('${expandId}')">
      <td>${i + 1}</td>
      <td>${p.name} ${iplBadge(iplTeam)} <span class="expand-arrow">&#9662;</span></td>
      <td style="color:var(--text-secondary)">${p.manager}</td>
      <td>${p.matches}</td>
      <td>${p.batting}</td>
      <td>${p.bowling}</td>
      <td>${p.fielding}</td>
      <td class="points-cell">${p.total}</td>
    </tr>${matchRows}`;
  }).join('');
  html += '</tbody></table>';

  container.innerHTML = html;

  container.querySelectorAll('.sortable-th').forEach(th => {
    th.addEventListener('click', (e) => {
      e.stopPropagation();
      const col = th.dataset.sort;
      if (topScorersSortKey === col) {
        topScorersSortAsc = !topScorersSortAsc;
      } else {
        topScorersSortKey = col;
        topScorersSortAsc = (col === 'name' || col === 'manager');
      }
      renderTopScorers();
    });
  });
}

function togglePlayerExpand(id) {
  const row = document.getElementById(id);
  if (row) row.classList.toggle('hidden');
}

// === Navigation ===
const allSections = ['leaderboard-section', 'title-race-section', 'all-matches', 'team-detail', 'scoring-rules', 'top-scorers', 'h2h-section', 'best-xi-section', 'heatmap-section', 'report-card-section'];

document.getElementById('back-btn').addEventListener('click', () => {
  allSections.forEach(id => document.getElementById(id).classList.add('hidden'));
  document.getElementById('leaderboard-section').classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-view="leaderboard-section"]').classList.add('active');
});

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    allSections.forEach(id => document.getElementById(id).classList.add('hidden'));
    document.getElementById(btn.dataset.view).classList.remove('hidden');
    // Auto-expand live match on Matches tab, collapse on others
    const cm = document.getElementById('current-match');
    if (btn.dataset.view === 'all-matches') {
      cm.classList.remove('collapsed');
    } else {
      cm.classList.add('collapsed');
    }
  });
});

// Auto-refresh every 5 minutes
setInterval(loadData, 5 * 60 * 1000);

// Initial load
loadData();

// ═══════════════════════════════════════════════════════════════════
// === HEAD TO HEAD COMPARISON =======================================
// ═══════════════════════════════════════════════════════════════════

let h2hBound = false;

function renderH2H() {
  if (!teamsData?.teams?.length) return;

  const selA = document.getElementById('h2h-team-a');
  const selB = document.getElementById('h2h-team-b');
  if (!selA || !selB) return;

  const teamNames = teamsData.teams.map(t => t.name);

  if (!h2hBound) {
    h2hBound = true;
    [selA, selB].forEach(sel => {
      teamNames.forEach((name, i) => {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', drawH2H);
    });
    // Default: first vs second
    selA.value = teamNames[0] || '';
    selB.value = teamNames[1] || '';
  }
  drawH2H();
}

function drawH2H() {
  const container = document.getElementById('h2h-content');
  if (!container) return;

  const nameA = document.getElementById('h2h-team-a')?.value;
  const nameB = document.getElementById('h2h-team-b')?.value;
  if (!nameA || !nameB || nameA === nameB) {
    container.innerHTML = '<p class="section-intro">Pick two different teams.</p>';
    return;
  }

  const teamA = teamsData.teams.find(t => t.name === nameA);
  const teamB = teamsData.teams.find(t => t.name === nameB);
  if (!teamA || !teamB) return;

  const history = data?.matchHistory || [];

  // Aggregate cumulative raw per player
  const rawA = {}, rawB = {};
  teamA.players.forEach(p => rawA[p.name] = 0);
  teamB.players.forEach(p => rawB[p.name] = 0);

  const matchScoresA = [], matchScoresB = [];

  for (const match of history) {
    const ps = match.playerScores || {};
    let mA = 0, mB = 0;
    for (const p of teamA.players) {
      const s = ps[p.name];
      if (s) { rawA[p.name] += s.total; mA += s.total; }
    }
    for (const p of teamB.players) {
      const s = ps[p.name];
      if (s) { rawB[p.name] += s.total; mB += s.total; }
    }
    matchScoresA.push(mA);
    matchScoresB.push(mB);
  }

  // Top-11 totals
  const totalA = computeTop11PointsForTeam(teamA, rawA);
  const totalB = computeTop11PointsForTeam(teamB, rawB);
  const winsA = matchScoresA.filter((s, i) => s > matchScoresB[i]).length;
  const winsB = matchScoresB.filter((s, i) => s > matchScoresA[i]).length;
  const draws = matchScoresA.filter((s, i) => s === matchScoresB[i]).length;

  // Player-by-player comparison (shared IPL teams or just sorted lists)
  const playersA = teamA.players.map(p => {
    const raw = rawA[p.name] || 0;
    const mult = p.name === teamA.captain ? 2 : p.name === teamA.viceCaptain ? 1.5 : 1;
    return { name: p.name, iplTeam: p.iplTeam || '', role: p.role, pts: Math.round(raw * mult), raw };
  }).sort((a, b) => b.pts - a.pts);

  const playersB = teamB.players.map(p => {
    const raw = rawB[p.name] || 0;
    const mult = p.name === teamB.captain ? 2 : p.name === teamB.viceCaptain ? 1.5 : 1;
    return { name: p.name, iplTeam: p.iplTeam || '', role: p.role, pts: Math.round(raw * mult), raw };
  }).sort((a, b) => b.pts - a.pts);

  const maxPts = Math.max(...playersA.map(p => p.pts), ...playersB.map(p => p.pts), 1);

  function playerRow(p, side) {
    const barPct = Math.round((p.pts / maxPts) * 100);
    const bar = side === 'left'
      ? `<div class="h2h-bar-wrap left"><div class="h2h-bar" style="width:${barPct}%"></div></div>`
      : `<div class="h2h-bar-wrap right"><div class="h2h-bar" style="width:${barPct}%"></div></div>`;
    const name = `<span class="h2h-player-name">${p.name} ${iplBadge(p.iplTeam)}</span>`;
    const pts = `<span class="h2h-pts">${p.pts}</span>`;
    return side === 'left'
      ? `<div class="h2h-player left">${pts}${bar}${name}</div>`
      : `<div class="h2h-player right">${name}${bar}${pts}</div>`;
  }

  const maxRows = Math.max(playersA.length, playersB.length);
  let rows = '';
  for (let i = 0; i < maxRows; i++) {
    const pA = playersA[i];
    const pB = playersB[i];
    rows += `<div class="h2h-row">
      <div class="h2h-col">${pA ? playerRow(pA, 'left') : ''}</div>
      <div class="h2h-col">${pB ? playerRow(pB, 'right') : ''}</div>
    </div>`;
  }

  // Match-by-match sparkline data
  const n = history.length;
  let cumA = 0, cumB = 0;
  let sparkRows = '';
  for (let i = 0; i < n; i++) {
    cumA += matchScoresA[i];
    cumB += matchScoresB[i];
    const winner = matchScoresA[i] > matchScoresB[i] ? 'A' : matchScoresB[i] > matchScoresA[i] ? 'B' : '-';
    sparkRows += `<tr>
      <td class="h2h-match-name">${history[i].name ? history[i].name.replace(/ vs /, ' v ') : `M${i+1}`}</td>
      <td class="${winner === 'A' ? 'fp-positive' : ''}" style="text-align:right">${matchScoresA[i]}</td>
      <td class="${winner === 'B' ? 'fp-positive' : ''}" style="text-align:left">${matchScoresB[i]}</td>
      <td style="color:var(--text-muted);font-size:0.7rem">${winner === 'A' ? nameA.split(' ')[0] : winner === 'B' ? nameB.split(' ')[0] : 'Draw'}</td>
    </tr>`;
  }

  container.innerHTML = `
    <div class="h2h-scoreboard card">
      <div class="h2h-score-row">
        <div class="h2h-score-block ${totalA > totalB ? 'h2h-winner' : ''}">
          <div class="h2h-score-name">${nameA}</div>
          <div class="h2h-score-pts">${totalA}</div>
          <div class="h2h-score-sub">Top 11 pts</div>
        </div>
        <div class="h2h-score-divider">
          <div class="h2h-record">${winsA}–${draws}–${winsB}</div>
          <div class="h2h-record-label">W–D–W</div>
        </div>
        <div class="h2h-score-block ${totalB > totalA ? 'h2h-winner' : ''}">
          <div class="h2h-score-name">${nameB}</div>
          <div class="h2h-score-pts">${totalB}</div>
          <div class="h2h-score-sub">Top 11 pts</div>
        </div>
      </div>
    </div>

    <div class="h2h-players-header">
      <span>${nameA}</span><span>${nameB}</span>
    </div>
    <div class="h2h-players card">${rows}</div>

    ${n > 0 ? `
    <h3>Match by Match</h3>
    <div class="card" style="padding:8px">
      <table style="font-size:0.78rem">
        <thead><tr>
          <th>Match</th>
          <th style="text-align:right">${nameA.split(' ')[0]}</th>
          <th style="text-align:left">${nameB.split(' ')[0]}</th>
          <th>Winner</th>
        </tr></thead>
        <tbody>${sparkRows}</tbody>
      </table>
    </div>` : ''}
  `;
}

// ═══════════════════════════════════════════════════════════════════
// === DREAM XI (BEST XI) ============================================
// ═══════════════════════════════════════════════════════════════════

function renderBestXI() {
  const container = document.getElementById('best-xi-content');
  if (!container || !teamsData?.teams?.length) return;

  const history = data?.matchHistory || [];
  const playerMeta = {}; // name → { role, iplTeam, fantasyTeam, captain, viceCaptain }
  const rawTotals = {};

  for (const team of teamsData.teams) {
    for (const p of team.players) {
      playerMeta[p.name] = {
        role: p.role,
        iplTeam: p.iplTeam || '',
        fantasyTeam: team.name,
        isCaptain: p.name === team.captain,
        isVC: p.name === team.viceCaptain,
      };
      rawTotals[p.name] = 0;
    }
  }

  for (const match of history) {
    for (const [name, s] of Object.entries(match.playerScores || {})) {
      if (rawTotals[name] !== undefined) rawTotals[name] += s.total;
    }
  }

  // Pick best XI using same role rules as computeTop11PointsForTeam
  // but across ALL players in ALL teams
  const allPlayers = Object.entries(rawTotals).map(([name, raw]) => ({
    name,
    raw,
    role: playerMeta[name]?.role || '',
    iplTeam: playerMeta[name]?.iplTeam || '',
    fantasyTeam: playerMeta[name]?.fantasyTeam || '',
  })).sort((a, b) => b.raw - a.raw);

  const selected = new Set();
  for (const role of REQUIRED_ROLES_TOP11) {
    const best = allPlayers.find(p => p.role === role && !selected.has(p.name));
    if (best) selected.add(best.name);
  }
  for (const p of allPlayers) {
    if (selected.size >= 11) break;
    if (!selected.has(p.name)) selected.add(p.name);
  }

  const xi = allPlayers.filter(p => selected.has(p.name));
  // Captain = highest raw, VC = second highest
  xi.sort((a, b) => b.raw - a.raw);
  const captain = xi[0];
  const vc = xi[1];

  // Group by role for display
  const roleOrder = ['Opener', 'Batsman', 'Wicket Keeper', 'All-Rounder', 'Fast Bowler', 'Spinner'];
  const byRole = {};
  for (const p of xi) {
    const r = p.role || 'Other';
    if (!byRole[r]) byRole[r] = [];
    byRole[r].push(p);
  }

  let html = '<div class="best-xi-grid">';
  for (const role of roleOrder) {
    const players = byRole[role];
    if (!players?.length) continue;
    html += `<div class="best-xi-role-group">
      <div class="best-xi-role-label">${role}</div>`;
    for (const p of players) {
      const isCap = p.name === captain?.name;
      const isVC  = p.name === vc?.name;
      const mult  = isCap ? 2 : isVC ? 1.5 : 1;
      const effective = Math.round(p.raw * mult);
      html += `<div class="best-xi-card ${isCap ? 'xi-captain' : isVC ? 'xi-vc' : ''}">
        <div class="xi-badge-row">
          ${isCap ? '<span class="xi-badge cap">C</span>' : ''}
          ${isVC  ? '<span class="xi-badge vc">VC</span>' : ''}
          ${iplBadge(p.iplTeam)}
        </div>
        <div class="xi-name">${p.name}</div>
        <div class="xi-team">${p.fantasyTeam}</div>
        <div class="xi-pts">${effective}<span class="xi-pts-label"> pts${mult > 1 ? ' (' + mult + 'x)' : ''}</span></div>
      </div>`;
    }
    html += '</div>';
  }
  html += '</div>';

  const totalPts = xi.reduce((sum, p) => {
    const mult = p.name === captain?.name ? 2 : p.name === vc?.name ? 1.5 : 1;
    return sum + Math.round(p.raw * mult);
  }, 0);

  container.innerHTML = `
    <div class="card" style="text-align:center;margin-bottom:12px">
      <div class="league-stat-label">Dream XI Total</div>
      <div class="league-stat-value">${totalPts} pts</div>
    </div>
    ${html}
  `;
}

// ═══════════════════════════════════════════════════════════════════
// === HEATMAP =======================================================
// ═══════════════════════════════════════════════════════════════════

let heatmapBound = false;

function renderHeatmap() {
  const container = document.getElementById('heatmap-content');
  const filterSel = document.getElementById('heatmap-team-filter');
  if (!container || !teamsData?.teams?.length) return;

  const history = (data?.matchHistory || []).filter(m => Object.keys(m.playerScores || {}).length > 0);
  if (history.length === 0) {
    container.innerHTML = '<p class="section-intro">No match data yet.</p>';
    return;
  }

  if (!heatmapBound && filterSel) {
    heatmapBound = true;
    // Populate team filter
    teamsData.teams.forEach(t => {
      const opt = document.createElement('option');
      opt.value = t.name;
      opt.textContent = t.name;
      filterSel.appendChild(opt);
    });
    filterSel.addEventListener('change', drawHeatmap);
  }
  drawHeatmap();
}

function drawHeatmap() {
  const container = document.getElementById('heatmap-content');
  const filterSel = document.getElementById('heatmap-team-filter');
  if (!container) return;

  const history = (data?.matchHistory || []).filter(m => Object.keys(m.playerScores || {}).length > 0);
  const filterTeam = filterSel?.value || 'all';

  // Collect players
  let players = [];
  const playerTeamMap = {};
  for (const team of (teamsData?.teams || [])) {
    for (const p of team.players) {
      playerTeamMap[p.name] = team.name;
      if (filterTeam === 'all' || team.name === filterTeam) {
        players.push({ name: p.name, team: team.name, role: p.role });
      }
    }
  }

  // Build score matrix: players × matches
  const scores = players.map(p =>
    history.map(m => {
      const s = m.playerScores?.[p.name];
      return s ? s.total : null; // null = didn't play
    })
  );

  // Find scale
  const allVals = scores.flat().filter(v => v !== null);
  const maxAbs = Math.max(Math.abs(Math.min(...allVals, 0)), Math.max(...allVals, 1));

  function cellColor(val) {
    if (val === null) return 'var(--bg-primary)';
    if (val === 0) return 'var(--bg-hover)';
    if (val > 0) {
      const intensity = Math.min(val / maxAbs, 1);
      const g = Math.round(74 + intensity * (180 - 74)); // 4ade80 range
      const r = Math.round(74 * (1 - intensity * 0.6));
      const b = Math.round(128 * (1 - intensity * 0.7));
      return `rgb(${r},${g},${b})`;
    } else {
      const intensity = Math.min(Math.abs(val) / maxAbs, 1);
      const r = Math.round(180 + intensity * 75);
      const g = Math.round(80 * (1 - intensity * 0.6));
      const b = Math.round(80 * (1 - intensity * 0.6));
      return `rgb(${r},${g},${b})`;
    }
  }

  // Abbreviate match labels
  const matchLabels = history.map((m, i) => {
    const teams = matchTeams(m.name || '');
    return teams.length === 2 ? `${teams[0]}<br>v ${teams[1]}` : `M${i+1}`;
  });

  // Sort players by total desc
  const playerTotals = players.map((p, pi) =>
    scores[pi].reduce((s, v) => s + (v || 0), 0)
  );
  const order = players.map((_, i) => i).sort((a, b) => playerTotals[b] - playerTotals[a]);

  let headerCells = matchLabels.map(l =>
    `<th class="heatmap-col-header">${l}</th>`
  ).join('');

  let bodyRows = order.map(pi => {
    const p = players[pi];
    const cells = scores[pi].map((val, mi) => {
      const bg = cellColor(val);
      const textColor = val === null ? 'transparent' : Math.abs(val) > maxAbs * 0.4 ? '#fff' : 'var(--text-primary)';
      return `<td class="heatmap-cell" style="background:${bg};color:${textColor}" title="${p.name} | ${history[mi]?.name || ''}: ${val ?? 'DNP'}">${val ?? ''}</td>`;
    }).join('');
    const total = playerTotals[pi];
    return `<tr>
      <td class="heatmap-player-name">${p.name}<br><span class="heatmap-team-tag">${p.team.split(' ').map(w=>w[0]).join('')}</span></td>
      ${cells}
      <td class="heatmap-total ${total > 0 ? 'fp-positive' : total < 0 ? 'fp-negative' : ''}">${total}</td>
    </tr>`;
  }).join('');

  container.innerHTML = `
    <div class="heatmap-scroll">
      <table class="heatmap-table">
        <thead>
          <tr>
            <th class="heatmap-player-header">Player</th>
            ${headerCells}
            <th class="heatmap-total-header">Total</th>
          </tr>
        </thead>
        <tbody>${bodyRows}</tbody>
      </table>
    </div>
    <div class="heatmap-legend">
      <span class="heatmap-legend-swatch" style="background:rgb(74,222,128)"></span> High
      <span class="heatmap-legend-swatch" style="background:var(--bg-hover)"></span> 0
      <span class="heatmap-legend-swatch" style="background:rgb(248,113,113)"></span> Negative
      <span class="heatmap-legend-swatch" style="background:var(--bg-primary);border:1px solid var(--border)"></span> DNP
    </div>
  `;
}

// ═══════════════════════════════════════════════════════════════════
// === MATCH REPORT CARD =============================================
// ═══════════════════════════════════════════════════════════════════

let reportBound = false;

function renderReportCard() {
  const sel = document.getElementById('report-match-select');
  const container = document.getElementById('report-card-content');
  if (!sel || !container) return;

  const history = (data?.matchHistory || []).filter(m => Object.keys(m.playerScores || {}).length > 0);
  if (history.length === 0) {
    container.innerHTML = '<p class="section-intro">No completed matches yet.</p>';
    return;
  }

  if (!reportBound) {
    reportBound = true;
    sel.addEventListener('change', drawReportCard);
  }

  // Repopulate selector (in case new matches came in)
  const currentVal = sel.value;
  sel.innerHTML = '';
  history.slice().reverse().forEach((m, ri) => {
    const i = history.length - 1 - ri;
    const opt = document.createElement('option');
    opt.value = String(i);
    opt.textContent = `M${i+1}: ${m.name || 'Match ' + (i+1)}${m.date ? ' (' + m.date + ')' : ''}`;
    sel.appendChild(opt);
  });
  // Restore or default to latest
  sel.value = currentVal && sel.querySelector(`option[value="${currentVal}"]`) ? currentVal : String(history.length - 1);

  drawReportCard();
}

function drawReportCard() {
  const sel = document.getElementById('report-match-select');
  const container = document.getElementById('report-card-content');
  const shareBtn = document.getElementById('report-share-btn');
  if (!sel || !container) return;

  const history = (data?.matchHistory || []).filter(m => Object.keys(m.playerScores || {}).length > 0);
  const idx = Number(sel.value);
  const match = history[idx];
  if (!match) return;

  const ps = match.playerScores || {};

  // Per-team totals for this match
  const teamResults = (teamsData?.teams || []).map(team => {
    let score = 0;
    const contributors = [];
    for (const p of team.players) {
      const s = ps[p.name];
      if (s) {
        const mult = p.name === team.captain ? 2 : p.name === team.viceCaptain ? 1.5 : 1;
        const eff = Math.round(s.total * mult);
        score += eff;
        if (s.total !== 0) contributors.push({ name: p.name, pts: eff, raw: s.total, iplTeam: p.iplTeam || '' });
      }
    }
    contributors.sort((a, b) => b.pts - a.pts);
    return { team: team.name, score, contributors };
  }).sort((a, b) => b.score - a.score);

  // Best individual performers
  const allPerformers = Object.entries(ps)
    .map(([name, s]) => ({ name, total: s.total, batting: s.batting, bowling: s.bowling, fielding: s.fielding }))
    .filter(p => p.total > 0)
    .sort((a, b) => b.total - a.total)
    .slice(0, 5);

  const worst = Object.entries(ps)
    .map(([name, s]) => ({ name, total: s.total }))
    .filter(p => p.total < 0)
    .sort((a, b) => a.total - b.total)
    .slice(0, 3);

  const winner = teamResults[0];
  const maxScore = teamResults[0]?.score || 1;

  const teamRows = teamResults.map((t, i) => {
    const barPct = Math.round((t.score / maxScore) * 100);
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}.`;
    const top = t.contributors[0];
    return `<div class="report-team-row ${i === 0 ? 'report-winner' : ''}">
      <div class="report-rank">${medal}</div>
      <div class="report-team-info">
        <div class="report-team-name">${t.team}</div>
        ${top ? `<div class="report-team-top">⭐ ${top.name} (${top.pts > 0 ? '+' : ''}${top.pts})</div>` : ''}
      </div>
      <div class="report-team-score-wrap">
        <div class="report-score-bar-track"><div class="report-score-bar" style="width:${barPct}%"></div></div>
        <div class="report-team-score">${t.score}</div>
      </div>
    </div>`;
  }).join('');

  const perfRows = allPerformers.map(p => {
    const parts = [];
    if (p.batting > 0) parts.push(`🏏 ${p.batting}`);
    if (p.bowling > 0) parts.push(`🎳 ${p.bowling}`);
    if (p.fielding > 0) parts.push(`🧤 ${p.fielding}`);
    return `<div class="report-performer">
      <div class="report-performer-name">${p.name}</div>
      <div class="report-performer-breakdown">${parts.join(' · ')}</div>
      <div class="report-performer-pts fp-positive">+${p.total}</div>
    </div>`;
  }).join('');

  const worstRows = worst.map(p =>
    `<div class="report-performer">
      <div class="report-performer-name">${p.name}</div>
      <div class="report-performer-pts fp-negative">${p.total}</div>
    </div>`
  ).join('');

  const iplTeams = matchTeams(match.name || '');
  const iplMatchHeader = iplTeams.length === 2
    ? `${teamLogo(iplTeams[0], 28)} ${iplTeams[0]} vs ${iplTeams[1]} ${teamLogo(iplTeams[1], 28)}`
    : (match.name || '');

  container.innerHTML = `
    <div class="report-card card" id="report-card-inner">
      <div class="report-header">
        <div class="report-match-name">${iplMatchHeader}</div>
        <div class="report-match-date">${match.date || ''}</div>
      </div>

      <div class="report-winner-banner">
        🏆 <strong>${winner.team}</strong> won the match day with <strong>${winner.score} pts</strong>
      </div>

      <h3 style="margin-top:16px">Team Standings</h3>
      <div class="report-teams">${teamRows}</div>

      ${allPerformers.length ? `<h3>Top Performers</h3><div class="report-performers">${perfRows}</div>` : ''}
      ${worst.length ? `<h3>Ones to Forget</h3><div class="report-performers">${worstRows}</div>` : ''}
    </div>
  `;

  if (shareBtn) {
    shareBtn.classList.remove('hidden');
    shareBtn.onclick = () => copyReportToClipboard(match, teamResults, allPerformers, worst);
  }
}

function copyReportToClipboard(match, teamResults, topPerformers, worst) {
  const iplTeams = matchTeams(match.name || '');
  const header = iplTeams.length === 2 ? `${iplTeams[0]} vs ${iplTeams[1]}` : match.name || 'Match';

  let text = `🏏 Fantasy IPL – ${header}`;
  if (match.date) text += ` (${match.date})`;
  text += '\n\n';

  text += '📊 Team Standings\n';
  const medals = ['🥇','🥈','🥉'];
  teamResults.forEach((t, i) => {
    text += `${medals[i] || `${i+1}.`} ${t.team} — ${t.score} pts`;
    if (t.contributors[0]) text += ` (⭐ ${t.contributors[0].name})`;
    text += '\n';
  });

  if (topPerformers.length) {
    text += '\n⭐ Top Performers\n';
    topPerformers.forEach(p => { text += `  ${p.name}: +${p.total}\n`; });
  }

  if (worst.length) {
    text += '\n📉 Ones to Forget\n';
    worst.forEach(p => { text += `  ${p.name}: ${p.total}\n`; });
  }

  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('report-share-btn');
    if (btn) { btn.textContent = '✅ Copied!'; setTimeout(() => { btn.textContent = '📋 Copy to clipboard'; }, 2000); }
  }).catch(() => {
    alert(text);
  });
}