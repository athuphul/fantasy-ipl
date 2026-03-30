const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

// --- Config ---
const IPL_LEAGUE_ID = '8048';
const DATA_DIR = path.join(__dirname, '..', 'data');
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');
const TEAMS_FILE = path.join(DATA_DIR, 'teams.json');
const SCHEDULE_FILE = path.join(DATA_DIR, 'schedule.json');
const API_SCHEDULE_FILE = path.join(DATA_DIR, 'api_generated_schedule_response.json');
const MATCH_SCORES_DIR = path.join(DATA_DIR, 'match_scores');
const FANTASY_SCORES_DIR = path.join(DATA_DIR, 'fantasy_scores');

// CricAPI keys (optional — used only for run out fielder data that ESPN lacks)
const CRICAPI_KEYS = [
  process.env.API_KEY_1,
  process.env.API_KEY_2,
  process.env.API_KEY_3,
  process.env.API_KEY_4,
  process.env.API_KEY_5,
  process.env.API_KEY_6,
].filter(Boolean);
let cricApiCallCount = 0;

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
  // Last name + first 3 chars of first name must match (avoids Singh/Sharma/Kumar collisions)
  if (aParts.length > 1 && bParts.length > 1) {
    const aLast = aParts[aParts.length - 1];
    const bLast = bParts[bParts.length - 1];
    const aFirst3 = aParts[0].substring(0, 3);
    const bFirst3 = bParts[0].substring(0, 3);
    if (aLast === bLast && aFirst3 === bFirst3) return true;
  }
  if (a.includes(b) || b.includes(a)) return true;
  return false;
}

function buildEspnIdMapping(rosters, allPlayers) {
  for (const roster of rosters) {
    const espnTeamAbbr = roster.team?.abbreviation || '';
    for (const p of roster.roster) {
      const espnId = p.athlete.id;
      if (espnIdToRoster[espnId]) continue; // Already mapped
      const espnName = p.athlete.displayName;
      // Prefer exact name match, then fuzzy match with IPL team verification
      let bestMatch = null;
      for (const rp of allPlayers) {
        const nameOk = namesMatch(espnName, rp.name);
        if (!nameOk) continue;
        const exactName = normalizeName(espnName) === normalizeName(rp.name);
        const teamOk = !espnTeamAbbr || !rp.iplTeam || espnTeamAbbr === rp.iplTeam;
        if (exactName && teamOk) { bestMatch = rp; break; }
        if (exactName && !bestMatch) { bestMatch = rp; continue; }
        if (teamOk && !bestMatch) { bestMatch = rp; }
      }
      if (bestMatch) {
        espnIdToRoster[espnId] = { rosterName: bestMatch.name, espnName };
      }
    }
  }
}

function getRosterName(espnId, espnDisplayName, allPlayers, espnTeamAbbr) {
  if (espnIdToRoster[espnId]) return espnIdToRoster[espnId].rosterName;
  // Fallback: try fuzzy match by name, prefer team-verified matches
  let bestMatch = null;
  for (const rp of allPlayers) {
    if (!namesMatch(espnDisplayName, rp.name)) continue;
    const teamOk = !espnTeamAbbr || !rp.iplTeam || espnTeamAbbr === rp.iplTeam;
    if (teamOk) { bestMatch = rp; break; }
    if (!bestMatch) bestMatch = rp;
  }
  if (bestMatch) {
    espnIdToRoster[espnId] = { rosterName: bestMatch.name, espnName: espnDisplayName };
    return bestMatch.name;
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
    const espnTeamAbbr = roster.team?.abbreviation || '';
    for (const player of roster.roster) {
      const espnId = player.athlete.id;
      const espnName = player.athlete.displayName;
      const rosterName = getRosterName(espnId, espnName, allPlayers, espnTeamAbbr);

      // Process linescores for fantasy roster players (batting/bowling/fielding)
      // AND for all players (run out credits to fielders)
      for (const linescore of (player.linescores || [])) {
        for (const inner of (linescore.linescores || [])) {
          if (rosterName) {
            const cats = inner.statistics?.categories || [];
            for (const cat of cats) {
              const stats = parseStatsArray(cat.stats || []);

              // Batting: player batted in this period
              if (stats.batted && stats.batted >= 1) {
                if (!playerPoints[rosterName]) playerPoints[rosterName] = { batting: 0, bowling: 0, fielding: 0, total: 0 };
                playerPoints[rosterName].batting += computeBattingPoints(stats);
              }

              // Bowling: player bowled in this period
              if (stats.overs && stats.overs > 0) {
                if (!playerPoints[rosterName]) playerPoints[rosterName] = { batting: 0, bowling: 0, fielding: 0, total: 0 };
                playerPoints[rosterName].bowling += computeBowlingPoints(stats);
              }

              // Fielding: catches and stumpings from fielding periods
              if (stats.fielded && stats.fielded >= 1 && stats.inningsFielded >= 1) {
                if (!playerPoints[rosterName]) playerPoints[rosterName] = { batting: 0, bowling: 0, fielding: 0, total: 0 };
                playerPoints[rosterName].fielding += computeFieldingPoints(stats);
              }
            }
          }

          // Run outs: check ALL players' outDetails (fielder may be on a fantasy team
          // even if the dismissed batsman is not)
          const batting = inner.batting;
          if (batting?.outDetails) {
            const od = batting.outDetails;
            if (od.dismissalCard === 'ro' && od.fielders) {
              for (const f of od.fielders) {
                const fielderId = f.athlete?.id;
                const fielderName = f.athlete?.displayName;
                if (!fielderId && !fielderName) continue;
                const fielderRoster = getRosterName(fielderId, fielderName || '', allPlayers, espnTeamAbbr);
                if (!fielderRoster) continue;
                if (!playerPoints[fielderRoster]) {
                  playerPoints[fielderRoster] = { batting: 0, bowling: 0, fielding: 0, total: 0 };
                }
                if (f.displayOrder === 0) {
                  playerPoints[fielderRoster].fielding += 10; // direct runout
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

// --- Full Scorecard Extraction ---
// Extracts batting and bowling cards per innings for UI display (all players, not just fantasy).

function extractFullScorecard(summaryData) {
  const innings = [];
  if (!summaryData.rosters) return innings;

  // Group players by team
  const teamRosters = {};
  for (const roster of summaryData.rosters) {
    const teamAbbr = roster.team?.abbreviation || '';
    const teamName = roster.team?.displayName || teamAbbr;
    teamRosters[teamAbbr] = { teamName, players: roster.roster };
  }

  // Each roster player may have multiple linescores (one per innings they participated in).
  // We need to figure out which innings each player batted/bowled in.
  // ESPN linescores are indexed by innings period. We'll collect per-period data.
  const periodBatting = {};  // periodIndex -> [{ name, runs, balls, fours, sixes, sr, dismissal, team }]
  const periodBowling = {};  // periodIndex -> [{ name, overs, maidens, runs, wickets, economy, team }]

  for (const roster of summaryData.rosters) {
    const teamAbbr = roster.team?.abbreviation || '';
    const teamName = roster.team?.displayName || teamAbbr;
    for (const player of roster.roster) {
      const name = player.athlete.displayName;
      let periodIdx = 0;
      for (const linescore of (player.linescores || [])) {
        for (const inner of (linescore.linescores || [])) {
          const cats = inner.statistics?.categories || [];
          for (const cat of cats) {
            const stats = parseStatsArray(cat.stats || []);

            if (stats.batted && stats.batted >= 1) {
              if (!periodBatting[periodIdx]) periodBatting[periodIdx] = [];
              const od = inner.batting?.outDetails;
              let dismissalStr = 'not out';
              if (od && od.dismissalCard) {
                const card = od.dismissalCard;
                const bowler = od.bowler?.displayName || '';
                const fielders = (od.fielders || []).map(f => f.athlete?.displayName).filter(Boolean);
                if (card === 'c' && fielders.length > 0) dismissalStr = `c ${fielders[0]} b ${bowler}`;
                else if (card === 'b') dismissalStr = `b ${bowler}`;
                else if (card === 'lbw') dismissalStr = `lbw b ${bowler}`;
                else if (card === 'st' && fielders.length > 0) dismissalStr = `st ${fielders[0]} b ${bowler}`;
                else if (card === 'ro' || card === 'run out') dismissalStr = `run out (${fielders.join('/')})`;
                else if (card === 'hit wicket') dismissalStr = `hit wicket b ${bowler}`;
                else if (card === 'retired hurt' || card === 'retired out') dismissalStr = card;
                else dismissalStr = `${card} ${bowler}`.trim();
              } else if ((stats.dismissal || 0) >= 1) {
                // Stats say dismissed but no outDetails — use dismissalCard from stats
                const card = stats.dismissalCard || 'out';
                dismissalStr = card;
              }
              periodBatting[periodIdx].push({
                name,
                runs: stats.runs || 0,
                balls: stats.ballsFaced || 0,
                fours: stats.fours || 0,
                sixes: stats.sixes || 0,
                sr: stats.strikeRate || 0,
                dismissal: dismissalStr,
                team: teamAbbr,
                teamName,
              });
            }

            if (stats.overs && stats.overs > 0) {
              if (!periodBowling[periodIdx]) periodBowling[periodIdx] = [];
              periodBowling[periodIdx].push({
                name,
                overs: stats.overs || 0,
                maidens: stats.maidens || 0,
                runs: stats.runsConceded || stats.runs || 0,
                wickets: stats.wickets || 0,
                economy: stats.economyRate || 0,
                team: teamAbbr,
                teamName,
              });
            }
          }
          periodIdx++;
        }
      }
    }
  }

  // Build innings from header competitions for labels
  const competitions = summaryData.header?.competitions || [];
  const inningsLabels = [];
  for (const comp of competitions) {
    for (const competitor of (comp.competitors || [])) {
      const teamName = competitor.team?.displayName || competitor.team?.abbreviation || '';
      for (const ls of (competitor.linescores || [])) {
        if (ls.isBatting !== undefined || (ls.runs || 0) > 0 || (ls.wickets || 0) > 0) {
          inningsLabels.push({
            team: teamName,
            runs: ls.runs || 0,
            wickets: ls.wickets || 0,
            overs: ls.overs || 0,
          });
        }
      }
    }
  }

  // Match periods to innings - batting team defines the innings
  const periodKeys = Object.keys(periodBatting).sort((a, b) => a - b);
  for (let i = 0; i < periodKeys.length; i++) {
    const pk = periodKeys[i];
    const batters = periodBatting[pk] || [];
    const bowlers = periodBowling[pk] || [];
    const battingTeam = batters[0]?.teamName || `Innings ${i + 1}`;
    const label = inningsLabels[i] || {};

    innings.push({
      innings: `${battingTeam}`,
      runs: label.runs || batters.reduce((s, b) => s + b.runs, 0),
      wickets: label.wickets,
      overs: label.overs,
      batting: batters.map(b => ({
        name: b.name,
        runs: b.runs,
        balls: b.balls,
        fours: b.fours,
        sixes: b.sixes,
        sr: Math.round(b.sr * 100) / 100,
        dismissal: b.dismissal,
      })),
      bowling: bowlers.map(b => ({
        name: b.name,
        overs: b.overs,
        maidens: b.maidens,
        runs: b.runs,
        wickets: b.wickets,
        economy: Math.round(b.economy * 100) / 100,
      })),
    });
  }

  return innings;
}

// --- CricAPI Run Out Supplement ---
// ESPN doesn't include run out fielder info. CricAPI does.
// We fetch the CricAPI scorecard and extract ONLY run out data.

const TEAM_SHORT_TO_FULL = {
  CSK: 'Chennai Super Kings', MI: 'Mumbai Indians', RCB: 'Royal Challengers Bengaluru',
  KKR: 'Kolkata Knight Riders', SRH: 'Sunrisers Hyderabad', RR: 'Rajasthan Royals',
  DC: 'Delhi Capitals', PBKS: 'Punjab Kings', GT: 'Gujarat Titans', LSG: 'Lucknow Super Giants',
};

function getCricApiKey() {
  const key = CRICAPI_KEYS[cricApiCallCount % CRICAPI_KEYS.length];
  cricApiCallCount++;
  return key;
}

async function cricApiCall(endpoint, params = {}) {
  const url = new URL(`https://api.cricapi.com/v1/${endpoint}`);
  url.searchParams.set('apikey', getCricApiKey());
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const res = await fetch(url.toString());
  if (!res.ok) throw new Error(`CricAPI HTTP ${res.status}`);
  return res.json();
}

function findCricApiMatchId(scheduleMatch) {
  if (!fs.existsSync(API_SCHEDULE_FILE)) return null;
  const apiSchedule = JSON.parse(fs.readFileSync(API_SCHEDULE_FILE, 'utf8'));
  const matchList = apiSchedule.data?.matchList || [];
  const homeFullName = TEAM_SHORT_TO_FULL[scheduleMatch.home];
  const awayFullName = TEAM_SHORT_TO_FULL[scheduleMatch.away];
  const found = matchList.find(m =>
    m.date === scheduleMatch.date &&
    m.teams?.includes(homeFullName) && m.teams?.includes(awayFullName)
  );
  return found?.id || null;
}

function findScheduleMatchForEvent(eventName, eventDate) {
  // eventName like "Mumbai Indians v Kolkata Knight Riders"
  const schedule = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
  return schedule.find(m => {
    if (eventDate && m.date !== eventDate) return false;
    const home = TEAM_SHORT_TO_FULL[m.home] || '';
    const away = TEAM_SHORT_TO_FULL[m.away] || '';
    return eventName.includes(home) && eventName.includes(away);
  });
}

async function supplementRunOuts(playerScores, eventName, eventDate, allPlayers) {
  if (CRICAPI_KEYS.length === 0) return;

  const scheduleMatch = findScheduleMatchForEvent(eventName, eventDate);
  if (!scheduleMatch) {
    console.log('  CricAPI: could not find schedule match for run out lookup');
    return;
  }

  const cricApiMatchId = findCricApiMatchId(scheduleMatch);
  if (!cricApiMatchId) {
    console.log('  CricAPI: no match ID found in api_generated_schedule_response.json');
    return;
  }

  try {
    console.log(`  CricAPI: fetching scorecard ${cricApiMatchId} for run out data`);
    const result = await cricApiCall('match_scorecard', { id: cricApiMatchId });
    if (!result.data?.scorecard) {
      console.log('  CricAPI: no scorecard data available');
      return;
    }

    for (const inning of result.data.scorecard) {
      // Direct run outs from catching/fielding section
      if (inning.catching) {
        for (const catcher of inning.catching) {
          const runouts = catcher.runout || 0;
          if (runouts === 0) continue;
          const name = catcher.fielder?.name;
          if (!name) continue;
          const roster = findPlayerInAllPlayers(name, allPlayers);
          if (!roster) continue;
          if (!playerScores[roster]) playerScores[roster] = { batting: 0, bowling: 0, fielding: 0, total: 0 };
          playerScores[roster].fielding += runouts * 10;
          playerScores[roster].total = playerScores[roster].batting + playerScores[roster].bowling + playerScores[roster].fielding;
          console.log(`  CricAPI: +${runouts * 10} run out pts for ${roster} (direct)`);
        }
      }

      // Run out assists from batting dismissals
      if (inning.batting) {
        for (const bat of inning.batting) {
          if (bat.dismissal === 'runout' && bat.bowler?.name) {
            const assister = findPlayerInAllPlayers(bat.bowler.name, allPlayers);
            if (!assister) continue;
            if (!playerScores[assister]) playerScores[assister] = { batting: 0, bowling: 0, fielding: 0, total: 0 };
            playerScores[assister].fielding += 5;
            playerScores[assister].total = playerScores[assister].batting + playerScores[assister].bowling + playerScores[assister].fielding;
            console.log(`  CricAPI: +5 run out assist pts for ${assister}`);
          }
        }
      }
    }
  } catch (err) {
    console.log(`  CricAPI run out fetch failed (non-fatal): ${err.message}`);
  }
}

function findPlayerInAllPlayers(apiName, allPlayers) {
  for (const rp of allPlayers) {
    if (namesMatch(apiName, rp.name)) return rp.name;
  }
  return null;
}

// --- Match Score Caching ---

function saveMatchScore(matchId, matchData) {
  if (!fs.existsSync(MATCH_SCORES_DIR)) fs.mkdirSync(MATCH_SCORES_DIR, { recursive: true });
  const file = path.join(MATCH_SCORES_DIR, `${matchId}.json`);
  fs.writeFileSync(file, JSON.stringify(matchData, null, 2));
  console.log(`  Saved match scorecard to ${file}`);
}

function saveFantasyScores(matchId, playerScores) {
  if (!fs.existsSync(FANTASY_SCORES_DIR)) fs.mkdirSync(FANTASY_SCORES_DIR, { recursive: true });
  const file = path.join(FANTASY_SCORES_DIR, `${matchId}.json`);
  fs.writeFileSync(file, JSON.stringify(playerScores, null, 2));
  console.log(`  Saved fantasy scores to ${file}`);
}

function loadCachedFantasyScores(matchId) {
  const file = path.join(FANTASY_SCORES_DIR, `${matchId}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) { return null; }
}

function loadCachedMatchScore(matchId) {
  const file = path.join(MATCH_SCORES_DIR, `${matchId}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) { return null; }
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
    execSync('git add data/scores.json data/match_scores data/fantasy_scores', { cwd: path.join(__dirname, '..') });
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
  console.log(`\n=== ESPN backend — single fetch run ===`);
  console.log(`[${new Date().toISOString()}] CricAPI keys available: ${CRICAPI_KEYS.length}`);

  // Set up git
  try {
    execSync('git config user.name "github-actions[bot]"', { cwd: path.join(__dirname, '..') });
    execSync('git config user.email "github-actions[bot]@users.noreply.github.com"', { cwd: path.join(__dirname, '..') });
  } catch (e) { /* may already be set */ }

  const teams = JSON.parse(fs.readFileSync(TEAMS_FILE, 'utf8')).teams;
  const allPlayers = teams.flatMap(t => t.players);
  console.log(`Loaded ${teams.length} fantasy teams, ${allPlayers.length} total players`);

  let existing = { lastUpdated: null, matchHistory: [], leaderboard: [], teamDetails: {}, currentMatch: null };
  if (fs.existsSync(SCORES_FILE)) {
    try { existing = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8')); } catch (e) { /* start fresh */ }
  }
  console.log(`Existing match history: ${existing.matchHistory.length} match(es)`);
  for (const m of existing.matchHistory) {
    console.log(`  ${m.name} [${m.matchId}] isComplete=${m.isComplete}`);
  }

  // Reprocess stale matches first (isComplete=false regardless of today's schedule)
  const staleMatches = existing.matchHistory.filter(m => !m.isComplete);
  let hasStaleUpdates = false;
  if (staleMatches.length > 0) {
    console.log(`\n=== Reprocessing ${staleMatches.length} incomplete match(es) ===`);
    for (const stale of staleMatches) {
      console.log(`\n  [INCOMPLETE] ${stale.name} (${stale.date})`);

      // Try to re-fetch from ESPN first (match might still be in header)
      const espnEventId = stale.matchId.replace('espn_', '');
      try {
        console.log(`  Re-fetching ESPN summary for event ${espnEventId}`);
        const summary = await fetchJson(SUMMARY_URL(espnEventId));
        const playerScores = processEspnSummary(summary, allPlayers);

        const scoredPlayers = Object.entries(playerScores).filter(([_, s]) => s.total !== 0);
        console.log(`  ESPN: ${Object.keys(playerScores).length} fantasy players found, ${scoredPlayers.length} with non-zero scores`);
        for (const [name, s] of scoredPlayers) {
          console.log(`    ${name}: bat=${s.batting} bowl=${s.bowling} field=${s.fielding} total=${s.total}`);
        }

        // Supplement with CricAPI run out data
        await supplementRunOuts(playerScores, stale.name, stale.date, allPlayers);

        // Update the match entry
        stale.playerScores = playerScores;
        const score = extractMatchInfo(summary);
        stale.score = score;
        stale.scorecard = extractFullScorecard(summary);
        stale.status = summary.header?.competitions?.[0]?.status?.type?.detail || stale.status;

        // Check if match is now complete
        const statusState = summary.header?.competitions?.[0]?.status?.type?.state;
        if (statusState === 'post' || stale.status?.includes('won') || stale.status?.includes('tied')) {
          stale.isComplete = true;
          saveFantasyScores(stale.matchId, playerScores);
          saveMatchScore(stale.matchId, { name: stale.name, date: stale.date, status: stale.status, venue: stale.venue, score });
          console.log(`  Marked as complete and cached`);
        } else {
          console.log(`  Still in progress (status: ${stale.status})`);
        }
        hasStaleUpdates = true;
      } catch (err) {
        console.log(`  ESPN re-fetch failed: ${err.message}`);
        // Fallback: just supplement run outs with CricAPI and mark complete
        await supplementRunOuts(stale.playerScores, stale.name, stale.date, allPlayers);
        for (const key of Object.keys(stale.playerScores)) {
          const p = stale.playerScores[key];
          p.total = p.batting + p.bowling + p.fielding;
        }
        stale.isComplete = true;
        saveFantasyScores(stale.matchId, stale.playerScores);
        saveMatchScore(stale.matchId, { name: stale.name, date: stale.date, status: stale.status, venue: stale.venue, score: stale.score });
        console.log(`  Marked as complete (ESPN unavailable, used existing + CricAPI)`);
        hasStaleUpdates = true;
      }
    }
  }

  // Check local schedule — exit early if no match today or outside window
  // (but only after reprocessing stale matches above)
  const todayMatches = getScheduleForToday();
  const inWindow = todayMatches.length > 0 && isMatchWindowNow(todayMatches);

  if (!inWindow && !hasStaleUpdates) {
    if (todayMatches.length === 0) {
      console.log(`\nNo matches scheduled today (${getTodayIST()}). Exiting.`);
    } else {
      console.log(`\nMatch(es) today but not in current window. Scheduled: ${todayMatches.map(m => `${m.home} vs ${m.away} @ ${m.time} IST`).join(', ')}. Exiting.`);
    }
    return;
  }

  if (!inWindow && hasStaleUpdates) {
    // We updated stale matches but no live match to check — just write and exit
    console.log(`\nNo live match window, but updated ${staleMatches.length} stale match(es). Writing output.`);
    const output = buildOutput(existing, teams, null);
    writeAndPush(output);
    console.log(`\n=== Final Leaderboard ===`);
    for (const entry of output.leaderboard) {
      console.log(`  ${entry.team}: ${entry.top11Points} (top 11) / ${entry.totalPointsAll} (all)`);
    }
    console.log('Done.');
    return;
  }

  // Fetch current IPL events from ESPN header
  let iplEvents;
  try {
    iplEvents = await getIplEventIds();
    console.log(`\n[${new Date().toISOString()}] ESPN header: ${iplEvents.length} IPL event(s)`);
    for (const ev of iplEvents) {
      console.log(`  ${ev.name} [${ev.id}] status=${ev.status}`);
    }
  } catch (err) {
    console.error(`Error fetching ESPN header: ${err.message}`);
    return;
  }

  if (iplEvents.length === 0) {
    console.log('No IPL events found on ESPN header.');
  }

  let currentMatch = null;

  // Process events from ESPN header
  for (const event of iplEvents) {
    const matchId = `espn_${event.id}`;
    const existingEntry = existing.matchHistory.find(m => m.matchId === matchId);

    // Check cache first — if we have cached fantasy scores, use them
    const cached = loadCachedFantasyScores(matchId);
    if (cached && existingEntry?.isComplete) {
      console.log(`\n  [CACHED] ${event.name}: loaded from fantasy_scores/${matchId}.json`);
      continue;
    }

    if (existingEntry?.isComplete && !cached) {
      // Complete but not cached — cache it now from existing data, skip refetch
      console.log(`\n  [CACHE-SAVE] ${event.name}: complete, saving to cache`);
      saveFantasyScores(matchId, existingEntry.playerScores);
      saveMatchScore(matchId, { name: existingEntry.name, date: existingEntry.date, status: existingEntry.status, venue: existingEntry.venue, score: existingEntry.score });
      continue;
    }

    if (event.status === 'pre') {
      console.log(`\n  [SKIP] ${event.name}: pre-match`);
      continue;
    }

    console.log(`\n  [FETCH] ${event.name} (status=${event.status})`);
    try {
      const summary = await fetchJson(SUMMARY_URL(event.id));
      const playerScores = processEspnSummary(summary, allPlayers);
      const isComplete = event.status === 'post';

      const scoredPlayers = Object.entries(playerScores).filter(([_, s]) => s.total !== 0);
      console.log(`  ESPN: ${Object.keys(playerScores).length} fantasy players found, ${scoredPlayers.length} with non-zero scores`);
      for (const [name, s] of scoredPlayers) {
        console.log(`    ${name}: bat=${s.batting} bowl=${s.bowling} field=${s.fielding} total=${s.total}`);
      }

      // Supplement with CricAPI run out data (if API keys available)
      const eventDate = event.date ? event.date.slice(0, 10) : getTodayIST();
      await supplementRunOuts(playerScores, event.name, eventDate, allPlayers);

      const statusDetail = event.fullStatus?.type?.detail || event.status;
      const score = extractMatchInfo(summary);
      const scorecard = extractFullScorecard(summary);

      const matchEntry = {
        matchId,
        name: event.name,
        date: eventDate,
        status: statusDetail,
        venue: summary.gameInfo?.venue?.fullName || '',
        score,
        scorecard,
        playerScores,
        isComplete,
      };

      const idx = existing.matchHistory.findIndex(m => m.matchId === matchId);
      if (idx >= 0) {
        console.log(`  Updating existing match entry`);
        existing.matchHistory[idx] = matchEntry;
      } else {
        console.log(`  Adding new match entry`);
        existing.matchHistory.push(matchEntry);
      }

      if (!isComplete) {
        currentMatch = {
          matchId,
          name: event.name,
          status: statusDetail,
          venue: matchEntry.venue,
          score,
          playerScores,
        };
      } else {
        // Match complete — save to cache
        saveFantasyScores(matchId, playerScores);
        saveMatchScore(matchId, { name: event.name, date: eventDate, status: statusDetail, venue: matchEntry.venue, score });
      }
      console.log(`  Match marked isComplete=${isComplete}`);
    } catch (err) {
      console.error(`  Error fetching summary for ${event.id}: ${err.message}`);
    }
  }

  // Write, commit, push
  console.log(`\n=== Building output and writing ===`);
  const output = buildOutput(existing, teams, currentMatch);
  writeAndPush(output);

  console.log(`\n=== Final Leaderboard ===`);
  for (const entry of output.leaderboard) {
    console.log(`  ${entry.team}: ${entry.top11Points} (top 11) / ${entry.totalPointsAll} (all)`);
  }

  console.log('Done.');
}

main().then(() => {
  process.exit(0);
}).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
