const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// --- Config ---
const IPL_LEAGUE_ID = '8048';
const DATA_DIR = path.join(__dirname, '..', 'data');
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');
const TEAMS_FILE = path.join(DATA_DIR, 'teams.json');
const SCHEDULE_FILE = path.join(DATA_DIR, 'schedule.json');

// ESPN APIs are free — no key needed.
// This script does a SINGLE fetch and exits. Cron handles repetition (every 10 min).
// This keeps GitHub Actions minutes low (~1 min per run vs 210 min for a long-running loop).

const HEADER_URL = 'https://site.api.espn.com/apis/personalized/v2/scoreboard/header?sport=cricket&region=in&tz=Asia/Calcutta';
const SUMMARY_URL = (eventId) =>
  `https://site.web.api.espn.com/apis/site/v2/sports/cricket/${IPL_LEAGUE_ID}/summary?contentorigin=espn&event=${eventId}&lang=en&region=in`;

// --- ESPN Player ID → Fantasy Roster Name Mapping ---
// Built dynamically on first summary fetch via fuzzy name matching.
// Maps ESPN athlete ID → { rosterName, espnName }
// TODO: Persist this mapping to a file (CSV/JSON) so it doesn't need to be
// rebuilt via fuzzy match on every Actions run. Would also let us manually
// fix any mismatches.
const espnIdToRoster = {};

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

// --- Scoring Rules (identical to CricAPI backend) ---

function computeBattingPoints(stats) {
  let pts = 0;
  const runs = stats.runs || 0;
  const balls = stats.ballsFaced || 0;
  const fours = stats.fours || 0;
  const sixes = stats.sixes || 0;
  const sr = stats.strikeRate || (balls > 0 ? (runs / balls) * 100 : 0);
  const dismissed = (stats.dismissal || 0) >= 1;

  pts += runs;
  pts += fours * 1;
  pts += sixes * 2;

  if (runs >= 50) pts += 10;
  if (runs >= 100) pts += 30;

  if (balls >= 10) {
    if (sr >= 200) pts += 15;
    else if (sr >= 175) pts += 10;
    else if (sr >= 150) pts += 5;
    else if (sr < 75) pts -= 10;
    else if (sr < 100) pts -= 5;
  }

  if (runs === 0 && dismissed) pts -= 5;

  return pts;
}

function computeBowlingPoints(stats) {
  let pts = 0;
  const overs = stats.overs || 0;
  const wickets = stats.wickets || 0;
  const eco = stats.economyRate || 0;

  pts += wickets * 25;

  if (wickets >= 5) pts += 30;
  else if (wickets >= 4) pts += 20;
  else if (wickets >= 3) pts += 10;

  if (overs >= 2) {
    if (eco <= 6.0) pts += 20;
    else if (eco <= 7.0) pts += 12;
    else if (eco <= 8.0) pts += 5;
    else if (eco >= 14.0) pts -= 15;
    else if (eco >= 12.0) pts -= 10;
    else if (eco >= 10.0) pts -= 5;
  }

  return pts;
}

function computeFieldingPoints(stats) {
  let pts = 0;
  // caught = total catches (fielder + keeper). caughtFielder = outfield only.
  // We use 'caught' for total catches taken by this player while fielding.
  pts += (stats.caught || 0) * 8;
  pts += (stats.stumped || 0) * 10;
  // Run outs are handled separately from outDetails
  return pts;
}

// --- Name Matching ---

function normalizeName(name) {
  return name.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

function namesMatch(espnName, rosterName) {
  const a = normalizeName(espnName);
  const b = normalizeName(rosterName);
  if (a === b) return true;
  const aParts = a.split(' ');
  const bParts = b.split(' ');
  if (aParts.length > 0 && bParts.length > 0) {
    const aLast = aParts[aParts.length - 1];
    const bLast = bParts[bParts.length - 1];
    if (aLast === bLast && aParts[0][0] === bParts[0][0]) return true;
  }
  if (a.includes(b) || b.includes(a)) return true;
  return false;
}

function buildEspnIdMapping(rosters, allPlayers) {
  for (const roster of rosters) {
    for (const p of roster.roster) {
      const espnId = p.athlete.id;
      if (espnIdToRoster[espnId]) continue; // Already mapped
      const espnName = p.athlete.displayName;
      for (const rp of allPlayers) {
        if (namesMatch(espnName, rp.name)) {
          espnIdToRoster[espnId] = { rosterName: rp.name, espnName };
          break;
        }
      }
    }
  }
}

function getRosterName(espnId, espnDisplayName, allPlayers) {
  if (espnIdToRoster[espnId]) return espnIdToRoster[espnId].rosterName;
  // Fallback: try fuzzy match by name
  for (const rp of allPlayers) {
    if (namesMatch(espnDisplayName, rp.name)) {
      espnIdToRoster[espnId] = { rosterName: rp.name, espnName: espnDisplayName };
      return rp.name;
    }
  }
  return null;
}

// --- Scorecard Processing ---

function parseStatsArray(statsArray) {
  const result = {};
  for (const s of statsArray) {
    result[s.name] = s.value;
  }
  return result;
}

function processEspnSummary(summaryData, allPlayers) {
  const playerPoints = {};
  if (!summaryData.rosters) return playerPoints;

  buildEspnIdMapping(summaryData.rosters, allPlayers);

  for (const roster of summaryData.rosters) {
    for (const player of roster.roster) {
      const espnId = player.athlete.id;
      const espnName = player.athlete.displayName;
      const rosterName = getRosterName(espnId, espnName, allPlayers);
      if (!rosterName) continue;

      if (!playerPoints[rosterName]) {
        playerPoints[rosterName] = { batting: 0, bowling: 0, fielding: 0, total: 0 };
      }

      for (const linescore of (player.linescores || [])) {
        for (const inner of (linescore.linescores || [])) {
          const cats = inner.statistics?.categories || [];
          for (const cat of cats) {
            const stats = parseStatsArray(cat.stats || []);

            // Batting: player batted in this period
            if (stats.batted && stats.batted >= 1) {
              playerPoints[rosterName].batting += computeBattingPoints(stats);
            }

            // Bowling: player bowled in this period
            if (stats.overs && stats.overs > 0) {
              playerPoints[rosterName].bowling += computeBowlingPoints(stats);
            }

            // Fielding: catches and stumpings from fielding periods
            if (stats.fielded && stats.fielded >= 1 && stats.inningsFielded >= 1) {
              playerPoints[rosterName].fielding += computeFieldingPoints(stats);
            }
          }

          // Run outs from batting outDetails
          const batting = inner.batting;
          if (batting?.outDetails) {
            const od = batting.outDetails;
            if (od.dismissalCard === 'ro' && od.fielders) {
              for (const f of od.fielders) {
                const fielderId = f.athlete?.id;
                const fielderName = f.athlete?.displayName;
                if (!fielderId && !fielderName) continue;
                const fielderRoster = getRosterName(fielderId, fielderName || '', allPlayers);
                if (!fielderRoster) continue;
                if (!playerPoints[fielderRoster]) {
                  playerPoints[fielderRoster] = { batting: 0, bowling: 0, fielding: 0, total: 0 };
                }
                // First fielder = direct, additional = assist
                if (f.displayOrder === 0) {
                  // If only one fielder listed, it's a direct runout
                  // If multiple, first is direct, rest are assists
                  if (od.fielders.length === 1) {
                    playerPoints[fielderRoster].fielding += 10;
                  } else {
                    playerPoints[fielderRoster].fielding += 10; // direct
                  }
                } else {
                  playerPoints[fielderRoster].fielding += 5; // assist
                }
              }
            }
          }
        }
      }
    }
  }

  for (const key of Object.keys(playerPoints)) {
    const p = playerPoints[key];
    p.total = p.batting + p.bowling + p.fielding;
  }
  return playerPoints;
}

// --- Build Output (same structure as CricAPI backend) ---

function buildOutput(existing, teams, currentMatch) {
  const IPL_SERIES_ID = '87c62aac-bc3c-4738-ab93-19da0690488f';
  const teamDetails = {};
  for (const team of teams) {
    const playerTotals = {};
    for (const player of team.players) {
      playerTotals[player.name] = { batting: 0, bowling: 0, fielding: 0, total: 0 };
    }

    for (const match of existing.matchHistory) {
      for (const player of team.players) {
        const scores = match.playerScores[player.name];
        if (scores) {
          playerTotals[player.name].batting += scores.batting;
          playerTotals[player.name].bowling += scores.bowling;
          playerTotals[player.name].fielding += scores.fielding;
          playerTotals[player.name].total += scores.total;
        }
      }
    }

    const playerList = team.players.map(p => {
      const totals = playerTotals[p.name];
      let multiplier = 1;
      if (p.name === team.captain) multiplier = 2;
      else if (p.name === team.viceCaptain) multiplier = 1.5;
      const effectivePoints = Math.round(totals.total * multiplier);
      return {
        name: p.name, role: p.role,
        batting: totals.batting, bowling: totals.bowling, fielding: totals.fielding,
        rawPoints: totals.total, multiplier, effectivePoints,
      };
    });

    playerList.sort((a, b) => b.effectivePoints - a.effectivePoints);
    playerList.forEach((p, i) => { p.countsInTop11 = i < 11; });

    teamDetails[team.name] = {
      totalPointsAll: playerList.reduce((sum, p) => sum + p.effectivePoints, 0),
      top11Points: playerList.slice(0, 11).reduce((sum, p) => sum + p.effectivePoints, 0),
      players: playerList,
    };
  }

  const leaderboard = teams
    .map(t => ({ team: t.name, totalPointsAll: teamDetails[t.name].totalPointsAll, top11Points: teamDetails[t.name].top11Points }))
    .sort((a, b) => b.top11Points - a.top11Points);

  return {
    lastUpdated: new Date().toISOString(),
    iplSeriesId: IPL_SERIES_ID,
    currentMatch,
    leaderboard,
    matchHistory: existing.matchHistory,
    teamDetails,
  };
}

function writeAndPush(output) {
  fs.writeFileSync(SCORES_FILE, JSON.stringify(output, null, 2));
  try {
    execSync('git add data/scores.json', { cwd: path.join(__dirname, '..') });
    execSync('git diff --staged --quiet', { cwd: path.join(__dirname, '..'), stdio: 'pipe' });
    console.log('No changes to commit');
  } catch (e) {
    if (e.status === 1) {
      const msg = `Update scores (ESPN) ${new Date().toISOString()} [skip ci]`;
      execSync(`git commit -m "${msg}"`, { cwd: path.join(__dirname, '..') });
      execSync('git push', { cwd: path.join(__dirname, '..') });
      console.log('Committed and pushed');
    } else {
      console.error('Git error:', e.message);
    }
  }
}

// --- Schedule Logic ---

function getTodayIST() {
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  return ist.toISOString().slice(0, 10);
}

function getScheduleForToday() {
  const schedule = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
  const today = getTodayIST();
  return schedule.filter(m => m.date === today);
}

function isMatchWindowNow(todayMatches) {
  const nowUTC = new Date();
  const hourUTC = nowUTC.getUTCHours() + nowUTC.getUTCMinutes() / 60;
  for (const m of todayMatches) {
    const istHour = parseInt(m.time.split(':')[0]);
    const istMin = parseInt(m.time.split(':')[1]);
    const startUTC = (istHour - 5.5) + istMin / 60;
    const endUTC = startUTC + 4;
    if (hourUTC >= startUTC - 0.25 && hourUTC <= endUTC) return true;
  }
  return false;
}

// --- ESPN Event ID Discovery ---

async function getIplEventIds() {
  const data = await fetchJson(HEADER_URL);
  const events = [];
  for (const sport of (data.sports || [])) {
    for (const league of (sport.leagues || [])) {
      if (league.id === IPL_LEAGUE_ID) {
        for (const ev of (league.events || [])) {
          events.push({
            id: ev.id,
            name: ev.name || ev.shortName,
            shortName: ev.shortName,
            date: ev.date,
            status: ev.status, // "pre", "in", "post"
            fullStatus: ev.fullStatus,
            competitors: ev.competitors || [],
          });
        }
      }
    }
  }
  return events;
}

function extractMatchInfo(summaryData) {
  // Extract score lines from header if available
  const header = summaryData.header;
  const score = [];
  if (header?.competitions) {
    for (const comp of header.competitions) {
      for (const competitor of (comp.competitors || [])) {
        const teamName = competitor.team?.displayName || competitor.team?.abbreviation || '';
        for (const ls of (competitor.linescores || [])) {
          // Skip fielding innings (isBatting false with 0 runs)
          if (!ls.isBatting && (ls.runs || 0) === 0) continue;
          score.push({
            inning: `${teamName}`,
            r: ls.runs || 0,
            w: ls.wickets || 0,
            o: ls.overs || 0,
          });
        }
      }
    }
  }
  return score;
}

// --- Main (single fetch and exit — cron handles repetition) ---

async function main() {
  // Step 0: Check local schedule (exit fast if no match today or outside window)
  const todayMatches = getScheduleForToday();
  if (todayMatches.length === 0) {
    console.log(`No matches scheduled today (${getTodayIST()}). Exiting.`);
    return;
  }

  if (!isMatchWindowNow(todayMatches)) {
    console.log(`Match(es) today but not in current window. Scheduled: ${todayMatches.map(m => `${m.home} vs ${m.away} @ ${m.time} IST`).join(', ')}. Exiting.`);
    return;
  }

  console.log(`ESPN backend — single fetch run`);

  // Set up git
  try {
    execSync('git config user.name "github-actions[bot]"', { cwd: path.join(__dirname, '..') });
    execSync('git config user.email "github-actions[bot]@users.noreply.github.com"', { cwd: path.join(__dirname, '..') });
  } catch (e) { /* may already be set */ }

  const teams = JSON.parse(fs.readFileSync(TEAMS_FILE, 'utf8')).teams;
  const allPlayers = teams.flatMap(t => t.players);

  let existing = { lastUpdated: null, matchHistory: [], leaderboard: [], teamDetails: {}, currentMatch: null };
  if (fs.existsSync(SCORES_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8')); } catch (e) { /* start fresh */ }
  }

  // Fetch current IPL events from ESPN header
  let iplEvents;
  try {
    iplEvents = await getIplEventIds();
    console.log(`[${new Date().toISOString()}] ESPN header: ${iplEvents.length} IPL event(s)`);
    for (const ev of iplEvents) {
      console.log(`  ${ev.name} [${ev.id}] status=${ev.status}`);
    }
  } catch (err) {
    console.error(`Error fetching ESPN header: ${err.message}`);
    return;
  }

  if (iplEvents.length === 0) {
    console.log('No IPL events found on ESPN. Exiting.');
    return;
  }

  let currentMatch = null;

  for (const event of iplEvents) {
    // Skip completed matches we've already processed
    const existingEntry = existing.matchHistory.find(m => m.matchId === `espn_${event.id}`);
    if (existingEntry?.isComplete) continue;

    // Skip pre-match events
    if (event.status === 'pre') {
      console.log(`  ${event.name}: pre-match, skipping scorecard fetch`);
      continue;
    }

    console.log(`  Fetching summary: ${event.name}`);
    try {
      const summary = await fetchJson(SUMMARY_URL(event.id));
      const playerScores = processEspnSummary(summary, allPlayers);
      const isComplete = event.status === 'post';

      const statusDetail = event.fullStatus?.type?.detail || event.status;
      const score = extractMatchInfo(summary);

      const matchEntry = {
        matchId: `espn_${event.id}`,
        name: event.name,
        date: event.date ? event.date.slice(0, 10) : getTodayIST(),
        status: statusDetail,
        venue: summary.gameInfo?.venue?.fullName || '',
        score,
        playerScores,
        isComplete,
      };

      const idx = existing.matchHistory.findIndex(m => m.matchId === matchEntry.matchId);
      if (idx >= 0) existing.matchHistory[idx] = matchEntry;
      else existing.matchHistory.push(matchEntry);

      if (!isComplete) {
        currentMatch = {
          matchId: matchEntry.matchId,
          name: event.name,
          status: statusDetail,
          venue: matchEntry.venue,
          score,
          playerScores,
        };
      }
    } catch (err) {
      console.error(`Error fetching summary for ${event.id}: ${err.message}`);
    }
  }

  // Write, commit, push
  const output = buildOutput(existing, teams, currentMatch);
  writeAndPush(output);

  for (const entry of output.leaderboard) {
    console.log(`  ${entry.team}: ${entry.top11Points} (top 11)`);
  }

  console.log('Done.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
