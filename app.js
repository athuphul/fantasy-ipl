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

    if (!initialLoadDone) initialLoadDone = true;
  } else {
    document.getElementById('leaderboard').querySelector('tbody').innerHTML =
      '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-muted)">No scores yet. Data will appear once matches begin.</td></tr>';
    renderAllMatches();
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
    let html = `<h3><span class="live-dot"></span>`;
    if (teams.length === 2) {
      html += `${teamLogo(teams[0], 20)} ${teams[0]} vs ${teams[1]} ${teamLogo(teams[1], 20)}`;
    } else {
      html += m.name;
    }
    html += `</h3>`;
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
    el.innerHTML = html;
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

  document.getElementById('leaderboard-section').classList.add('hidden');
  document.getElementById('all-matches').classList.add('hidden');
  document.getElementById('team-detail').classList.remove('hidden');
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
const allSections = ['leaderboard-section', 'all-matches', 'team-detail', 'scoring-rules', 'top-scorers'];

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
  });
});

// Auto-refresh every 5 minutes
setInterval(loadData, 5 * 60 * 1000);

// Initial load
loadData();
