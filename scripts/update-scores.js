const fs = require('fs');
const path = require('path');

const API_KEYS = [
  process.env.API_KEY_1,
  process.env.API_KEY_2,
  process.env.API_KEY_3,
  process.env.API_KEY_4,
  process.env.API_KEY_5,
  process.env.API_KEY_6,
].filter(Boolean);

const IPL_SERIES_ID = process.env.IPL_SERIES_ID;
const DATA_DIR = path.join(__dirname, '..', 'data');
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');
const TEAMS_FILE = path.join(DATA_DIR, 'teams.json');

function getApiKey() {
  const idx = new Date().getDate() % API_KEYS.length;
  return API_KEYS[idx];
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

// --- Scoring Rules ---

function computeBattingPoints(batsman) {
  let pts = 0;
  const runs = batsman.r || 0;
  const balls = batsman.b || 0;
  const fours = batsman['4s'] || 0;
  const sixes = batsman['6s'] || 0;
  const sr = balls > 0 ? (runs / balls) * 100 : 0;
  const dismissed = batsman.dismissal && batsman.dismissal !== 'not out' && batsman.dismissal !== 'retired hurt';

  // Runs
  pts += runs;

  // Boundary bonuses
  pts += fours * 1;
  pts += sixes * 2;

  // Milestones
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

  // Duck
  if (runs === 0 && dismissed) {
    pts -= 5;
  }

  return pts;
}

function computeBowlingPoints(bowler) {
  let pts = 0;
  const overs = bowler.o || 0;
  const wickets = bowler.w || 0;
  const eco = bowler.eco || 0;

  // Wickets
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
  pts += (catcher.stumped || 0) * 10;
  // The API has "runout" as a single number — we'll treat it as direct run outs (+10 each)
  // and run out assists aren't distinguished in the catching data, so we give +10 per runout
  pts += (catcher.runout || 0) * 10;
  return pts;
}

// --- Name Matching ---

function normalizeName(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function namesMatch(apiName, rosterName) {
  const a = normalizeName(apiName);
  const b = normalizeName(rosterName);
  if (a === b) return true;
  // Check if last names match and first initial matches
  const aParts = a.split(' ');
  const bParts = b.split(' ');
  if (aParts.length > 0 && bParts.length > 0) {
    const aLast = aParts[aParts.length - 1];
    const bLast = bParts[bParts.length - 1];
    if (aLast === bLast && aParts[0][0] === bParts[0][0]) return true;
  }
  // Substring containment
  if (a.includes(b) || b.includes(a)) return true;
  return false;
}

function findPlayerInRoster(apiName, allPlayers) {
  for (const p of allPlayers) {
    if (namesMatch(apiName, p.name)) return p;
  }
  return null;
}

// --- Main Logic ---

async function getMatchList() {
  const data = await apiCall('series_info', { id: IPL_SERIES_ID });
  return data.data?.matchList || [];
}

async function getScorecard(matchId) {
  const data = await apiCall('match_scorecard', { id: matchId });
  return data.data;
}

function processScorecard(scorecard, allPlayers) {
  const playerPoints = {}; // playerId -> { batting, bowling, fielding, total }

  if (!scorecard?.scorecard) return playerPoints;

  for (const inning of scorecard.scorecard) {
    // Batting
    if (inning.batting) {
      for (const bat of inning.batting) {
        const name = bat.batsman?.name;
        if (!name) continue;
        const roster = findPlayerInRoster(name, allPlayers);
        if (!roster) continue;
        const key = roster.name;
        if (!playerPoints[key]) playerPoints[key] = { batting: 0, bowling: 0, fielding: 0, total: 0 };
        playerPoints[key].batting += computeBattingPoints(bat);
      }
    }

    // Bowling
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

    // Fielding
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

  // Compute totals
  for (const key of Object.keys(playerPoints)) {
    const p = playerPoints[key];
    p.total = p.batting + p.bowling + p.fielding;
  }

  return playerPoints;
}

async function main() {
  if (!IPL_SERIES_ID) {
    console.error('IPL_SERIES_ID not set');
    process.exit(1);
  }
  if (API_KEYS.length === 0) {
    console.error('No API keys configured');
    process.exit(1);
  }

  const teams = JSON.parse(fs.readFileSync(TEAMS_FILE, 'utf8')).teams;
  const allPlayers = teams.flatMap(t => t.players);

  // Load existing scores
  let existing = { lastUpdated: null, matchHistory: [], leaderboard: [], teamDetails: {}, currentMatch: null };
  if (fs.existsSync(SCORES_FILE)) {
    try {
      existing = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8'));
    } catch (e) {
      console.warn('Could not parse existing scores, starting fresh');
    }
  }

  const processedMatchIds = new Set(existing.matchHistory.map(m => m.matchId));

  // Get match list
  console.log('Fetching series info...');
  const matchList = await getMatchList();
  console.log(`Found ${matchList.length} matches in series`);

  let currentMatch = null;
  let newMatches = [];

  for (const match of matchList) {
    const matchId = match.id;
    const status = (match.status || '').toLowerCase();
    const isComplete = status.includes('won') || status.includes('tied') || status.includes('no result') || status.includes('draw');
    const isLive = match.matchStarted && !match.matchEnded;

    // Skip already processed completed matches
    if (processedMatchIds.has(matchId) && isComplete) continue;

    // Skip matches that haven't started and aren't live
    if (!match.matchStarted && !isLive) continue;

    console.log(`Fetching scorecard for: ${match.name} (${match.status})`);
    try {
      const scorecard = await getScorecard(matchId);
      if (!scorecard) continue;

      const playerScores = processScorecard(scorecard, allPlayers);

      if (isLive) {
        currentMatch = {
          matchId,
          name: match.name || scorecard.name,
          status: match.status || scorecard.status,
          venue: scorecard.venue,
          score: scorecard.score || [],
          playerScores,
        };
      }

      // Add or update match in history
      const matchEntry = {
        matchId,
        name: match.name || scorecard.name,
        date: match.date || scorecard.date,
        status: match.status || scorecard.status,
        venue: scorecard.venue,
        score: scorecard.score || [],
        playerScores,
        isComplete,
      };

      const existingIdx = existing.matchHistory.findIndex(m => m.matchId === matchId);
      if (existingIdx >= 0) {
        existing.matchHistory[existingIdx] = matchEntry;
      } else {
        newMatches.push(matchEntry);
      }
    } catch (err) {
      console.error(`Error processing match ${matchId}: ${err.message}`);
    }
  }

  existing.matchHistory.push(...newMatches);
  existing.currentMatch = currentMatch;

  // Compute team totals across all matches
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

    // Apply captain/VC multipliers
    const playerList = team.players.map(p => {
      const totals = playerTotals[p.name];
      let multiplier = 1;
      if (p.name === team.captain) multiplier = 2;
      else if (p.name === team.viceCaptain) multiplier = 1.5;
      const effectivePoints = Math.round(totals.total * multiplier);
      return {
        name: p.name,
        role: p.role,
        batting: totals.batting,
        bowling: totals.bowling,
        fielding: totals.fielding,
        rawPoints: totals.total,
        multiplier,
        effectivePoints,
      };
    });

    // Sort by effective points descending
    playerList.sort((a, b) => b.effectivePoints - a.effectivePoints);

    // Mark top 11
    playerList.forEach((p, i) => {
      p.countsInTop11 = i < 11;
    });

    const totalPointsAll = playerList.reduce((sum, p) => sum + p.effectivePoints, 0);
    const top11Points = playerList.slice(0, 11).reduce((sum, p) => sum + p.effectivePoints, 0);

    teamDetails[team.name] = {
      totalPointsAll,
      top11Points,
      players: playerList,
    };
  }

  // Build leaderboard sorted by top11Points
  const leaderboard = teams
    .map(t => ({
      team: t.name,
      totalPointsAll: teamDetails[t.name].totalPointsAll,
      top11Points: teamDetails[t.name].top11Points,
    }))
    .sort((a, b) => b.top11Points - a.top11Points);

  const output = {
    lastUpdated: new Date().toISOString(),
    iplSeriesId: IPL_SERIES_ID,
    currentMatch,
    leaderboard,
    matchHistory: existing.matchHistory,
    teamDetails,
  };

  fs.writeFileSync(SCORES_FILE, JSON.stringify(output, null, 2));
  console.log(`Scores updated at ${output.lastUpdated}`);
  console.log('Leaderboard:');
  for (const entry of leaderboard) {
    console.log(`  ${entry.team}: ${entry.top11Points} (top 11) / ${entry.totalPointsAll} (all)`);
  }
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
