let data = null;
let teamsData = null;
let scheduleData = null;

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

// Extract team abbreviations from match name like "Mumbai Indians v Kolkata Knight Riders"
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
    renderLastUpdated();
    renderCurrentMatch();
    renderLeaderboard();
    renderAllMatches();
    renderTopScorers();
  } else {
    document.getElementById('leaderboard').querySelector('tbody').innerHTML =
      '<tr><td colspan="4" style="text-align:center;padding:20px;color:#64748b">No scores yet. Data will appear once matches begin.</td></tr>';
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

function renderCurrentMatch() {
  const el = document.getElementById('current-match');
  if (!data.currentMatch) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  const m = data.currentMatch;
  const teams = matchTeams(m.name);
  let html = `<h3><span class="live-dot"></span>`;
  if (teams.length === 2) {
    html += `${teamLogo(teams[0], 20)} ${teams[0]} vs ${teams[1]} ${teamLogo(teams[1], 20)}`;
  } else {
    html += m.name;
  }
  html += `</h3>`;
  html += `<p style="font-size:0.8rem;color:#64748b">${m.venue || ''}</p>`;
  html += `<p style="font-size:0.8rem;color:#94a3b8">${m.status}</p>`;
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
}

function renderLeaderboard() {
  const tbody = document.getElementById('leaderboard').querySelector('tbody');
  if (!data.leaderboard || data.leaderboard.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;padding:20px;color:#64748b">No data yet</td></tr>';
    return;
  }
  tbody.innerHTML = data.leaderboard.map((entry, i) => {
    const rankClass = i < 3 ? `rank-${i + 1}` : '';
    return `<tr class="${rankClass}" onclick="showTeam('${entry.team}')">
      <td>${i + 1}</td>
      <td>${entry.team}</td>
      <td class="points-cell">${entry.top11Points}</td>
      <td class="points-cell" style="opacity:0.6">${entry.totalPointsAll}</td>
    </tr>`;
  }).join('');
}

function showTeam(teamName) {
  const detail = data.teamDetails[teamName];
  if (!detail) return;

  const teamMeta = teamsData?.teams?.find(t => t.name === teamName);

  document.getElementById('leaderboard-section').classList.add('hidden');
  document.getElementById('all-matches').classList.add('hidden');
  document.getElementById('team-detail').classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  document.getElementById('team-name').textContent = teamName;

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
      <div class="value" style="font-size:0.9rem;color:#fbbf24">${teamMeta?.captain || '-'}</div>
    </div>
    <div class="stat-box">
      <div class="label">Vice Captain</div>
      <div class="value" style="font-size:0.9rem;color:#a78bfa">${teamMeta?.viceCaptain || '-'}</div>
    </div>
  `;

  const iplTeamMap = {};
  if (teamMeta) {
    for (const pl of teamMeta.players) {
      iplTeamMap[pl.name] = pl.iplTeam || '';
    }
  }

  // Build per-player match breakdown
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
    container.innerHTML = '<p style="color:#64748b">No matches played yet</p>';
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

// --- Combined Scorecard + Fantasy Points ---

function renderCombinedScorecard(match) {
  if (!match.scorecard || match.scorecard.length === 0) return '';

  // Build fantasy lookup: playerName -> { team, batting, bowling, fielding, total }
  const fantasyMap = {};
  const playerFantasyTeamMap = {};
  const playerIplTeamMap = {};
  if (teamsData) {
    for (const team of teamsData.teams) {
      for (const p of team.players) {
        playerFantasyTeamMap[p.name] = team.name;
        playerIplTeamMap[p.name] = p.iplTeam || '';
      }
    }
  }
  for (const [name, s] of Object.entries(match.playerScores || {})) {
    fantasyMap[name] = s;
  }

  let html = '';
  for (const inn of match.scorecard) {
    html += `<div class="scorecard-innings">`;
    html += `<div class="innings-header">${inn.innings} — ${inn.runs}/${inn.wickets} (${inn.overs} ov)</div>`;

    // Batting table with fantasy points
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

    // Bowling table with fantasy points
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

  // Fielding points summary (not shown in batting/bowling tables)
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

function renderAllMatches() {
  const container = document.getElementById('matches-list');
  let html = '';

  const playerFantasyTeamMap = {};
  const playerIplTeamMap = {};
  if (teamsData) {
    for (const team of teamsData.teams) {
      for (const p of team.players) {
        playerFantasyTeamMap[p.name] = team.name;
        playerIplTeamMap[p.name] = p.iplTeam || '';
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

  // Upcoming schedule
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
      html += `<p style="color:#64748b;font-size:0.8rem;padding:8px 0">+ ${upcoming.length - 10} more matches</p>`;
    }
    html += '</div>';
  }

  // Completed matches
  if (matchHistory.length > 0) {
    html += '<h3>Results</h3>';
    html += matchHistory.slice().reverse().map(match => {
      const teams = matchTeams(match.name);
      const scoreLines = (match.score || []).map(s => `${s.inning}: ${s.r}/${s.w} (${s.o} ov)`).join(' | ');

      let headerHtml = match.name;
      if (teams.length === 2) {
        headerHtml = `${teamLogo(teams[0], 18)} ${teams[0]} vs ${teams[1]} ${teamLogo(teams[1], 18)}`;
      }

      // MVP strip — top 3 fantasy scorers for this match
      const mvps = Object.entries(match.playerScores || {})
        .map(([name, s]) => ({ name, total: s.total, manager: playerFantasyTeamMap[name] || '' }))
        .filter(p => p.total > 0)
        .sort((a, b) => b.total - a.total)
        .slice(0, 3);
      const mvpHtml = mvps.length > 0
        ? `<div class="mvp-strip">${mvps.map((p, i) => `<span class="mvp-chip${i === 0 ? ' mvp-gold' : ''}">${p.name} <span class="fp-positive">${p.total}</span></span>`).join('')}</div>`
        : '';

      const combinedHtml = renderCombinedScorecard(match);

      return `<details class="match-card">
        <summary>
          <span>${headerHtml} <span class="match-date">${match.date || ''}</span></span>
          <span class="match-date">${match.status || ''}</span>
        </summary>
        <p class="score-line" style="margin:8px 0">${scoreLines}</p>
        ${mvpHtml}
        ${combinedHtml}
      </details>`;
    }).join('');
  } else if (nextUp.length === 0) {
    html += '<p style="color:#64748b">No matches data available</p>';
  }

  container.innerHTML = html;
}

function renderTopScorers() {
  const container = document.getElementById('top-scorers-list');
  if (!data?.matchHistory || !teamsData) {
    container.innerHTML = '<p style="color:#64748b">No data yet</p>';
    return;
  }

  const playerFantasyTeamMap = {};
  const playerIplTeamMap = {};
  const playerMultiplierMap = {};
  for (const team of teamsData.teams) {
    for (const p of team.players) {
      playerFantasyTeamMap[p.name] = team.name;
      playerIplTeamMap[p.name] = p.iplTeam || '';
      playerMultiplierMap[p.name] = p.name === team.captain ? 2 : p.name === team.viceCaptain ? 1.5 : 1;
    }
  }

  // Accumulate totals and per-match data
  const totals = {};
  const playerMatches = {};
  for (const match of data.matchHistory) {
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

  const sorted = Object.entries(totals)
    .map(([name, t]) => ({ name, ...t }))
    .sort((a, b) => b.total - a.total);

  let html = `<table class="top-scorers-table">
    <thead><tr><th>#</th><th>Player</th><th>Manager</th><th>M</th><th>Bat</th><th>Bowl</th><th>Field</th><th>Pts</th></tr></thead>
    <tbody>`;
  html += sorted.map((p, i) => {
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
      <td style="color:#94a3b8">${playerFantasyTeamMap[p.name]}</td>
      <td>${p.matches}</td>
      <td>${p.batting}</td>
      <td>${p.bowling}</td>
      <td>${p.fielding}</td>
      <td class="points-cell">${p.total}</td>
    </tr>${matchRows}`;
  }).join('');
  html += '</tbody></table>';

  container.innerHTML = html;
}

function togglePlayerExpand(id) {
  const row = document.getElementById(id);
  if (row) row.classList.toggle('hidden');
}

const allSections = ['leaderboard-section', 'all-matches', 'team-detail', 'scoring-rules', 'top-scorers'];

// Navigation
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
