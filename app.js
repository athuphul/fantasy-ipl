let data = null;
let teamsData = null;
let scheduleData = null;

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
  } else {
    document.getElementById('leaderboard').querySelector('tbody').innerHTML =
      '<tr><td colspan="4" style="text-align:center;padding:20px;color:#64748b">No scores yet. Data will appear once matches begin.</td></tr>';
    renderAllMatches(); // Still render schedule even without scores
  }
}

function renderLastUpdated() {
  const el = document.getElementById('last-updated');
  if (data.lastUpdated) {
    const d = new Date(data.lastUpdated);
    el.textContent = `Last updated: ${d.toLocaleString()}`;
  }
}

function renderScorecardHtml(scorecard) {
  if (!scorecard || scorecard.length === 0) return '';
  let html = '';
  for (const inn of scorecard) {
    html += `<div class="scorecard-innings">`;
    html += `<div class="innings-header">${inn.innings}${inn.runs !== undefined ? ` — ${inn.runs}/${inn.wickets} (${inn.overs} ov)` : ''}</div>`;
    if (inn.batting && inn.batting.length > 0) {
      html += `<table class="scorecard-table"><thead><tr><th>Batter</th><th>R</th><th>B</th><th>4s</th><th>6s</th><th>SR</th></tr></thead><tbody>`;
      for (const b of inn.batting) {
        html += `<tr><td><span class="batter-name">${b.name}</span><br><span class="dismissal-text">${b.dismissal}</span></td><td>${b.runs}</td><td>${b.balls}</td><td>${b.fours}</td><td>${b.sixes}</td><td>${b.sr}</td></tr>`;
      }
      html += `</tbody></table>`;
    }
    if (inn.bowling && inn.bowling.length > 0) {
      html += `<table class="scorecard-table"><thead><tr><th>Bowler</th><th>O</th><th>M</th><th>R</th><th>W</th><th>Econ</th></tr></thead><tbody>`;
      for (const b of inn.bowling) {
        html += `<tr><td>${b.name}</td><td>${b.overs}</td><td>${b.maidens}</td><td>${b.runs}</td><td class="${b.wickets >= 3 ? 'wicket-haul' : ''}">${b.wickets}</td><td>${b.economy}</td></tr>`;
      }
      html += `</tbody></table>`;
    }
    html += `</div>`;
  }
  return html;
}

function renderCurrentMatch() {
  const el = document.getElementById('current-match');
  if (!data.currentMatch) {
    el.classList.add('hidden');
    return;
  }
  el.classList.remove('hidden');
  const m = data.currentMatch;
  let html = `<h3><span class="live-dot"></span>${m.name}</h3>`;
  html += `<p style="font-size:0.8rem;color:#64748b">${m.venue || ''}</p>`;
  html += `<p style="font-size:0.8rem;color:#94a3b8">${m.status}</p>`;
  if (m.score) {
    for (const s of m.score) {
      html += `<p class="score-line">${s.inning}: ${s.r}/${s.w} (${s.o} ov)</p>`;
    }
  }
  // Find scorecard from matchHistory
  const matchEntry = data.matchHistory?.find(mh => mh.matchId === m.matchId);
  if (matchEntry?.scorecard) {
    html += renderScorecardHtml(matchEntry.scorecard);
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

  // Build iplTeam lookup from teamsData
  const iplTeamMap = {};
  if (teamMeta) {
    for (const pl of teamMeta.players) {
      iplTeamMap[pl.name] = pl.iplTeam || '';
    }
  }

  const tbody = document.getElementById('team-players').querySelector('tbody');
  tbody.innerHTML = detail.players.map((p, i) => {
    const rowClass = p.countsInTop11 ? '' : 'not-top11';
    const nameClass = p.multiplier === 2 ? 'captain' : p.multiplier === 1.5 ? 'vice-captain' : '';
    const multLabel = p.multiplier === 2 ? '(C) 2x' : p.multiplier === 1.5 ? '(VC) 1.5x' : '1x';
    const iplTeam = iplTeamMap[p.name] || '';
    return `<tr class="${rowClass}">
      <td>${i + 1}</td>
      <td class="${nameClass}">${p.name} <span class="ipl-badge">${iplTeam}</span></td>
      <td>${p.role}</td>
      <td>${p.batting}</td>
      <td>${p.bowling}</td>
      <td>${p.fielding}</td>
      <td>${p.rawPoints}</td>
      <td>${multLabel}</td>
      <td class="points-cell">${p.effectivePoints}</td>
    </tr>`;
  }).join('');

  // Match history for this team's players
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

function renderAllMatches() {
  const container = document.getElementById('matches-list');
  let html = '';

  // Build lookup maps
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

  // Determine which matches are completed (by date from matchHistory)
  const completedDates = new Set();
  const matchHistory = data?.matchHistory || [];
  for (const m of matchHistory) {
    if (m.date) completedDates.add(m.date);
  }

  // Split schedule into upcoming and completed
  const today = new Date().toISOString().slice(0, 10);
  const upcoming = (scheduleData || []).filter(m => m.date >= today && !completedDates.has(m.date));
  // Show next 10 upcoming
  const nextUp = upcoming.slice(0, 10);

  // Upcoming schedule
  if (nextUp.length > 0) {
    html += '<h3>Upcoming</h3>';
    html += '<div class="schedule-grid">';
    let lastDate = '';
    for (const m of nextUp) {
      const dateLabel = m.date === lastDate ? '' : formatScheduleDate(m.date);
      // Convert IST to local time. Schedule times are IST (UTC+5:30)
      const [h, min] = m.time.split(':').map(Number);
      const matchUTC = new Date(`${m.date}T${String(h).padStart(2,'0')}:${String(min).padStart(2,'0')}:00+05:30`);
      const localTime = matchUTC.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      lastDate = m.date;
      html += `<div class="schedule-row${dateLabel ? '' : ' same-day'}">
        <div class="schedule-date">${dateLabel}</div>
        <div class="schedule-teams"><span class="ipl-badge">${m.home}</span> vs <span class="ipl-badge">${m.away}</span></div>
        <div class="schedule-meta">${localTime} &middot; ${m.venue}</div>
      </div>`;
    }
    if (upcoming.length > 10) {
      html += `<p style="color:#64748b;font-size:0.8rem;padding:8px 0">+ ${upcoming.length - 10} more matches</p>`;
    }
    html += '</div>';
  }

  // Completed matches with scores
  if (matchHistory.length > 0) {
    html += '<h3>Results</h3>';
    html += matchHistory.slice().reverse().map(match => {
      const players = Object.entries(match.playerScores)
        .map(([name, s]) => ({ name, ...s }))
        .sort((a, b) => b.total - a.total);

      const scoreLines = (match.score || []).map(s => `${s.inning}: ${s.r}/${s.w} (${s.o} ov)`).join(' | ');

      const scorecardHtml = match.scorecard ? renderScorecardHtml(match.scorecard) : '';

      return `<details class="match-card">
        <summary>
          <span>${match.name} <span class="match-date">${match.date || ''}</span></span>
          <span class="match-date">${match.status || ''}</span>
        </summary>
        <p class="score-line" style="margin:8px 0">${scoreLines}</p>
        ${scorecardHtml ? `<details class="scorecard-toggle"><summary>Full Scorecard</summary>${scorecardHtml}</details>` : ''}
        <details class="scorecard-toggle"><summary>Fantasy Points</summary>
        <table>
          <thead><tr><th>Player</th><th>Manager</th><th>Bat</th><th>Bowl</th><th>Field</th><th>Total</th></tr></thead>
          <tbody>${players.map(p =>
            `<tr>
              <td>${p.name} <span class="ipl-badge">${playerIplTeamMap[p.name] || ''}</span></td>
              <td style="color:#64748b">${playerFantasyTeamMap[p.name] || '-'}</td>
              <td>${p.batting}</td>
              <td>${p.bowling}</td>
              <td>${p.fielding}</td>
              <td class="points-cell">${p.total}</td>
            </tr>`
          ).join('')}</tbody>
        </table>
        </details>
      </details>`;
    }).join('');
  } else if (nextUp.length === 0) {
    html += '<p style="color:#64748b">No matches data available</p>';
  }

  container.innerHTML = html;
}

// Navigation
document.getElementById('back-btn').addEventListener('click', () => {
  document.getElementById('team-detail').classList.add('hidden');
  document.getElementById('scoring-rules').classList.add('hidden');
  document.getElementById('leaderboard-section').classList.remove('hidden');
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector('[data-view="leaderboard-section"]').classList.add('active');
});

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById('leaderboard-section').classList.add('hidden');
    document.getElementById('all-matches').classList.add('hidden');
    document.getElementById('team-detail').classList.add('hidden');
    document.getElementById('scoring-rules').classList.add('hidden');
    document.getElementById(btn.dataset.view).classList.remove('hidden');
  });
});

// Auto-refresh every 5 minutes
setInterval(loadData, 5 * 60 * 1000);

// Initial load
loadData();
