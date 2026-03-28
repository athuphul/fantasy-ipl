const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const API_KEYS = [
  process.env.API_KEY_1,
  process.env.API_KEY_2,
  process.env.API_KEY_3,
  process.env.API_KEY_4,
  process.env.API_KEY_5,
  process.env.API_KEY_6,
].filter(Boolean);

const IPL_SERIES_ID = process.env.IPL_SERIES_ID;
const MAX_RUNTIME_MS = 4.5 * 60 * 60 * 1000; // 4.5 hours (GH Actions limit is 6h)
const DATA_DIR = path.join(__dirname, '..', 'data');
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');
const TEAMS_FILE = path.join(DATA_DIR, 'teams.json');
const SCHEDULE_FILE = path.join(DATA_DIR, 'schedule.json');

// Credit budget: 6 keys x 100 = 600/day. Both series_info and scorecard cost ~10 credits.
// Single match:  1 series_info (10) + N scorecards (10 each) → budget 590/10 = 59 polls over ~3.5h → every 4 min
// Double header: 2 series_info (20) + N scorecards (10 each) → budget 580/10 = 58 polls over ~7h  → every 8 min
const POLL_INTERVAL_SINGLE_MS = 4 * 60 * 1000;
const POLL_INTERVAL_DOUBLE_MS = 8 * 60 * 1000;

// Round-robin API key rotation
let apiCallCount = 0;
function getApiKey() {
  const key = API_KEYS[apiCallCount % API_KEYS.length];
  apiCallCount++;
  return key;
}

async function apiCall(endpoint, params = {}) {
  const url = new URL(`https://api.cricapi.com/v1/${endpoint}`);
  url.searchParams.set('apikey', getApiKey());
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`API error: ${res.status} ${res.statusText}`);
  const data = await res.json();
  if (data.status === 'failure') throw new Error(`API failure: ${JSON.stringify(data)}`);
  return data;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Scoring Rules ---

function computeBattingPoints(batsman) {
  let pts = 0;
  const runs = batsman.r || 0;
  const balls = batsman.b || 0;
  const fours = batsman['4s'] || 0;
  const sixes = batsman['6s'] || 0;
  const sr = balls > 0 ? (runs / balls) * 100 : 0;
  const dismissed = batsman.dismissal && batsman.dismissal !== 'not out' && batsman.dismissal !== 'retired hurt';

  pts += runs;
  pts += fours * 1;
  pts += sixes * 2;

  // Milestones — century is cumulative with half-century (+10 + +30 = +40)
  if (runs >= 50) pts += 10;
  if (runs >= 100) pts += 30;

  // Strike rate bonuses/penalties (min 10 balls)
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

function computeBowlingPoints(bowler) {
  let pts = 0;
  const overs = bowler.o || 0;
  const wickets = bowler.w || 0;
  const eco = bowler.eco || 0;

  pts += wickets * 25;

  // Wicket haul bonuses (exclusive tiers)
  if (wickets >= 5) pts += 30;
  else if (wickets >= 4) pts += 20;
  else if (wickets >= 3) pts += 10;

  // Economy bonuses/penalties (min 2 overs)
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

function computeFieldingPoints(catcher) {
  let pts = 0;
  pts += (catcher.catch || 0) * 8;
  pts += (catcher.cb || 0) * 8;     // Caught and bowled counts as a catch
  pts += (catcher.stumped || 0) * 10;
  pts += (catcher.runout || 0) * 10; // Direct run outs from catching section
  return pts;
}

// --- Name Matching ---

function normalizeName(name) {
  return name.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
}

function namesMatch(apiName, rosterName) {
  const a = normalizeName(apiName);
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

function findPlayerInRoster(apiName, allPlayers) {
  for (const p of allPlayers) {
    if (namesMatch(apiName, p.name)) return p;
  }
  return null;
}

// --- Scorecard Processing ---

function processScorecard(scorecard, allPlayers) {
  const playerPoints = {};
  if (!scorecard?.scorecard) return playerPoints;

  for (const inning of scorecard.scorecard) {
    if (inning.batting) {
      for (const bat of inning.batting) {
        const name = bat.batsman?.name;
        if (!name) continue;
        const roster = findPlayerInRoster(name, allPlayers);
        if (!roster) continue;
        const key = roster.name;
        if (!playerPoints[key]) playerPoints[key] = { batting: 0, bowling: 0, fielding: 0, total: 0 };
        playerPoints[key].batting += computeBattingPoints(bat);

        // Run out assist: the "bowler" field on a runout dismissal is the assisting fielder (+5)
        if (bat.dismissal === 'runout' && bat.bowler?.name) {
          const assister = findPlayerInRoster(bat.bowler.name, allPlayers);
          if (assister) {
            const aKey = assister.name;
            if (!playerPoints[aKey]) playerPoints[aKey] = { batting: 0, bowling: 0, fielding: 0, total: 0 };
            playerPoints[aKey].fielding += 5;
          }
        }
      }
    }
    if (inning.bowling) {
      for (const bowl of inning.bowling) {
        const name = bowl.bowler?.name;
        if (!name) continue;
        const roster = findPlayerInRoster(name, allPlayers);
        if (!roster) continue;
        const key = roster.name;
        if (!playerPoints[key]) playerPoints[key] = { batting: 0, bowling: 0, fielding: 0, total: 0 };
        playerPoints[key].bowling += computeBowlingPoints(bowl);
      }
    }
    if (inning.catching) {
      for (const cat of inning.catching) {
        const name = cat.catcher?.name;
        if (!name) continue;
        const roster = findPlayerInRoster(name, allPlayers);
        if (!roster) continue;
        const key = roster.name;
        if (!playerPoints[key]) playerPoints[key] = { batting: 0, bowling: 0, fielding: 0, total: 0 };
        playerPoints[key].fielding += computeFieldingPoints(cat);
      }
    }
  }

  for (const key of Object.keys(playerPoints)) {
    const p = playerPoints[key];
    p.total = p.batting + p.bowling + p.fielding;
  }
  return playerPoints;
}

// --- Build Output ---

function buildOutput(existing, teams, currentMatch) {
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
    const diff = execSync('git diff --staged --quiet', { cwd: path.join(__dirname, '..'), stdio: 'pipe' }).toString();
    // No changes
    console.log('No changes to commit');
  } catch (e) {
    // git diff --staged --quiet exits 1 when there ARE changes
    if (e.status === 1) {
      const msg = `Update scores ${new Date().toISOString()}`;
      execSync(`git commit -m "${msg}"`, { cwd: path.join(__dirname, '..') });
      execSync('git push', { cwd: path.join(__dirname, '..') });
      console.log('Committed and pushed');
    } else {
      console.error('Git error:', e.message);
    }
  }
}

function isMatchLive(match) {
  const status = (match.status || '').toLowerCase();
  const isComplete = status.includes('won') || status.includes('tied') || status.includes('no result') || status.includes('draw');
  return match.matchStarted && !match.matchEnded && !isComplete;
}

function isMatchComplete(match) {
  const status = (match.status || '').toLowerCase();
  return status.includes('won') || status.includes('tied') || status.includes('no result') || status.includes('draw');
}

// --- Schedule Logic ---

function getTodayIST() {
  // IST = UTC+5:30
  const now = new Date();
  const ist = new Date(now.getTime() + (5.5 * 60 * 60 * 1000));
  return ist.toISOString().slice(0, 10); // YYYY-MM-DD
}

function getScheduleForToday() {
  const schedule = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
  const today = getTodayIST();
  return schedule.filter(m => m.date === today);
}

function isDoubleHeader(todayMatches) {
  return todayMatches.length >= 2;
}

function isMatchWindowNow(todayMatches) {
  // Check if current UTC time falls within any match window
  // 15:30 IST = 10:00 UTC, 19:30 IST = 14:00 UTC
  // Each match lasts ~3.5-4 hours
  const nowUTC = new Date();
  const hourUTC = nowUTC.getUTCHours() + nowUTC.getUTCMinutes() / 60;

  for (const m of todayMatches) {
    const istHour = parseInt(m.time.split(':')[0]);
    const istMin = parseInt(m.time.split(':')[1]);
    const startUTC = (istHour - 5.5) + istMin / 60; // Convert IST to UTC
    const endUTC = startUTC + 4; // ~4 hour window
    if (hourUTC >= startUTC - 0.25 && hourUTC <= endUTC) return true;
  }
  return false;
}

// --- Main Loop ---

async function main() {
  if (!IPL_SERIES_ID) { console.error('IPL_SERIES_ID not set'); process.exit(1); }
  if (API_KEYS.length === 0) { console.error('No API keys configured'); process.exit(1); }

  // Step 0: Check schedule before making any API calls (0 credits)
  const todayMatches = getScheduleForToday();
  if (todayMatches.length === 0) {
    console.log(`No matches scheduled today (${getTodayIST()}). Exiting. [0 credits used]`);
    return;
  }

  if (!isMatchWindowNow(todayMatches)) {
    console.log(`Match(es) today but not in current window. Scheduled: ${todayMatches.map(m => `${m.home} vs ${m.away} @ ${m.time} IST`).join(', ')}. Exiting. [0 credits used]`);
    return;
  }

  const doubleHeader = isDoubleHeader(todayMatches);
  const pollInterval = doubleHeader ? POLL_INTERVAL_DOUBLE_MS : POLL_INTERVAL_SINGLE_MS;
  console.log(`${doubleHeader ? 'Double header' : 'Single match'} day → polling every ${pollInterval / 60000} min`);
  console.log(`Matches: ${todayMatches.map(m => `${m.home} vs ${m.away} @ ${m.time} IST`).join(', ')}`);

  // Set up git for commits
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

  // Step 1: Check for live/completed matches (10 credits)
  console.log('Fetching series info...');
  const matchList = await apiCall('series_info', { id: IPL_SERIES_ID });
  const matches = matchList.data?.matchList || [];

  const liveMatches = matches.filter(m => isMatchLive(m));
  const newCompleted = matches.filter(m => isMatchComplete(m) && !existing.matchHistory.some(h => h.matchId === m.id));

  if (liveMatches.length === 0 && newCompleted.length === 0) {
    console.log(`No live or new completed matches found via API. Exiting. [~10 credits used]`);
    return;
  }

  // Process any newly completed matches we haven't seen
  for (const match of newCompleted) {
    console.log(`Processing completed match: ${match.name}`);
    try {
      const scorecard = await apiCall('match_scorecard', { id: match.id });
      if (!scorecard.data) continue;
      const playerScores = processScorecard(scorecard.data, allPlayers);
      existing.matchHistory.push({
        matchId: match.id, name: match.name || scorecard.data.name,
        date: match.date || scorecard.data.date, status: match.status || scorecard.data.status,
        venue: scorecard.data.venue, score: scorecard.data.score || [], playerScores, isComplete: true,
      });
    } catch (err) { console.error(`Error processing ${match.id}: ${err.message}`); }
  }

  if (liveMatches.length === 0) {
    console.log('No live matches, writing final scores for completed matches.');
    existing.currentMatch = null;
    const output = buildOutput(existing, teams, null);
    writeAndPush(output);
    return;
  }

  // Step 2: Live match found — enter polling loop
  console.log(`Found ${liveMatches.length} live match(es). Polling every ${pollInterval / 60000} min...`);
  const startTime = Date.now();

  while (Date.now() - startTime < MAX_RUNTIME_MS) {
    let anyLive = false;
    let currentMatch = null;

    for (const match of liveMatches) {
      console.log(`[${new Date().toISOString()}] Fetching scorecard: ${match.name}`);
      try {
        const scorecard = await apiCall('match_scorecard', { id: match.id });
        if (!scorecard.data) continue;

        const sc = scorecard.data;
        const playerScores = processScorecard(sc, allPlayers);
        const status = (sc.status || '').toLowerCase();
        const complete = status.includes('won') || status.includes('tied') || status.includes('no result') || status.includes('draw');

        const matchEntry = {
          matchId: match.id, name: sc.name || match.name,
          date: sc.date || match.date, status: sc.status || match.status,
          venue: sc.venue, score: sc.score || [], playerScores, isComplete: complete,
        };

        const idx = existing.matchHistory.findIndex(m => m.matchId === match.id);
        if (idx >= 0) existing.matchHistory[idx] = matchEntry;
        else existing.matchHistory.push(matchEntry);

        if (!complete) {
          anyLive = true;
          currentMatch = {
            matchId: match.id, name: sc.name || match.name,
            status: sc.status || match.status, venue: sc.venue,
            score: sc.score || [], playerScores,
          };
        }
      } catch (err) {
        console.error(`Error fetching ${match.id}: ${err.message}`);
        anyLive = true; // Assume still live on error, retry next loop
      }
    }

    // Write, commit, push after each poll
    const output = buildOutput(existing, teams, currentMatch);
    writeAndPush(output);

    console.log(`API calls so far: ${apiCallCount} (~${apiCallCount * 10} credits)`);
    for (const entry of output.leaderboard) {
      console.log(`  ${entry.team}: ${entry.top11Points} (top 11)`);
    }

    if (!anyLive) {
      console.log('All matches complete. Exiting.');
      return;
    }

    console.log(`Sleeping ${pollInterval / 1000}s...`);
    await sleep(pollInterval);
  }

  console.log('Max runtime reached. Exiting.');
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
