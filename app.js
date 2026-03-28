let data = null;
let teamsData = null;

async function loadData() {
  try {
    const [scoresRes, teamsRes] = await Promise.all([
      fetch('data/scores.json'),
      fetch('data/teams.json'),
    ]);
    if (scoresRes.ok) data = await scoresRes.json();
    if (teamsRes.ok) teamsData = await teamsRes.json();
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
  let html = `<h3><span class="live-dot"></span>${m.name}</h3>`;
  html += `<p style="font-size:0.8rem;color:#64748b">${m.venue || ''}</p>`;
  html += `<p style="font-size:0.8rem;color:#94a3b8">${m.status}</p>`;
  if (m.score) {
    for (const s of m.score) {
      html += `<p class="score-line">${s.inning}: ${s.r}/${s.w} (${s.o} ov)</p>`;
    }
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

  const tbody = document.getElementById('team-players').querySelector('tbody');
  tbody.innerHTML = detail.players.map((p, i) => {
    const rowClass = p.countsInTop11 ? '' : 'not-top11';
    const nameClass = p.multiplier === 2 ? 'captain' : p.multiplier === 1.5 ? 'vice-captain' : '';
    const multLabel = p.multiplier === 2 ? '(C) 2x' : p.multiplier === 1.5 ? '(VC) 1.5x' : '1x';
    return `<tr class="${rowClass}">
      <td>${i + 1}</td>
      <td class="${nameClass}">${p.name}</td>
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

function renderAllMatches() {
  const container = document.getElementById('matches-list');
  if (!data.matchHistory || data.matchHistory.length === 0) {
    container.innerHTML = '<p style="color:#64748b">No matches played yet</p>';
    return;
  }

  container.innerHTML = data.matchHistory.map(match => {
    const players = Object.entries(match.playerScores)
      .map(([name, s]) => ({ name, ...s }))
      .sort((a, b) => b.total - a.total);

    // Find which fantasy team each player belongs to
    const playerTeamMap = {};
    if (teamsData) {
      for (const team of teamsData.teams) {
        for (const p of team.players) {
          playerTeamMap[p.name] = team.name;
        }
      }
    }

    const scoreLines = (match.score || []).map(s => `${s.inning}: ${s.r}/${s.w} (${s.o} ov)`).join(' | ');

    return `<details class="match-card">
      <summary>
        <span>${match.name} <span class="match-date">${match.date || ''}</span></span>
        <span class="match-date">${match.status || ''}</span>
      </summary>
      <p class="score-line" style="margin:8px 0">${scoreLines}</p>
      <table>
        <thead><tr><th>Player</th><th>Team</th><th>Bat</th><th>Bowl</th><th>Field</th><th>Total</th></tr></thead>
        <tbody>${players.map(p =>
          `<tr>
            <td>${p.name}</td>
            <td style="color:#64748b">${playerTeamMap[p.name] || '-'}</td>
            <td>${p.batting}</td>
            <td>${p.bowling}</td>
            <td>${p.fielding}</td>
            <td class="points-cell">${p.total}</td>
          </tr>`
        ).join('')}</tbody>
      </table>
    </details>`;
  }).join('');
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
