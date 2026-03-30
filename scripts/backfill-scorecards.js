#!/usr/bin/env node
// One-time script to backfill full scorecards from CricAPI for completed matches
// that don't have scorecard data yet. Run locally or in CI with API keys.
//
// Usage: API_KEY_1=... node scripts/backfill-scorecards.js

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const SCORES_FILE = path.join(DATA_DIR, 'scores.json');
const API_SCHEDULE_FILE = path.join(DATA_DIR, 'api_generated_schedule_response.json');

const TEAM_SHORT_TO_FULL = {
  CSK: 'Chennai Super Kings', MI: 'Mumbai Indians', RCB: 'Royal Challengers Bengaluru',
  KKR: 'Kolkata Knight Riders', SRH: 'Sunrisers Hyderabad', RR: 'Rajasthan Royals',
  DC: 'Delhi Capitals', PBKS: 'Punjab Kings', GT: 'Gujarat Titans', LSG: 'Lucknow Super Giants',
};

const CRICAPI_KEYS = [
  process.env.API_KEY_1, process.env.API_KEY_2, process.env.API_KEY_3,
  process.env.API_KEY_4, process.env.API_KEY_5, process.env.API_KEY_6,
].filter(Boolean);
let keyIdx = 0;

function getKey() {
  const k = CRICAPI_KEYS[keyIdx % CRICAPI_KEYS.length];
  keyIdx++;
  return k;
}

async function fetchScorecard(matchId) {
  const url = `https://api.cricapi.com/v1/match_scorecard?apikey=${getKey()}&id=${matchId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function findCricApiMatchId(espnMatchName, espnDate) {
  const apiSchedule = JSON.parse(fs.readFileSync(API_SCHEDULE_FILE, 'utf8'));
  const matchList = apiSchedule.data?.matchList || [];
  return matchList.find(m => {
    if (m.date !== espnDate) return false;
    // Check if team names overlap
    for (const [abbr, full] of Object.entries(TEAM_SHORT_TO_FULL)) {
      if (espnMatchName.includes(full) && m.teams?.includes(full)) {
        // Check second team too
        for (const [abbr2, full2] of Object.entries(TEAM_SHORT_TO_FULL)) {
          if (full2 !== full && espnMatchName.includes(full2) && m.teams?.includes(full2)) {
            return true;
          }
        }
      }
    }
    return false;
  });
}

function convertCricApiScorecard(cricData) {
  const innings = [];
  for (const inn of (cricData.data?.scorecard || [])) {
    const totals = inn.totals || {};
    innings.push({
      innings: inn.inning?.replace(/ Inning \d+$/, '') || 'Unknown',
      runs: totals.R || 0,
      wickets: totals.W || 0,
      overs: totals.O || 0,
      batting: (inn.batting || []).map(b => ({
        name: b.batsman?.name || '',
        runs: b.r || 0,
        balls: b.b || 0,
        fours: b['4s'] || 0,
        sixes: b['6s'] || 0,
        sr: b.sr || 0,
        dismissal: b['dismissal-text'] || 'not out',
      })),
      bowling: (inn.bowling || []).map(b => ({
        name: b.bowler?.name || '',
        overs: b.o || 0,
        maidens: b.m || 0,
        runs: b.r || 0,
        wickets: b.w || 0,
        economy: b.eco || 0,
      })),
    });
  }
  return innings;
}

async function main() {
  if (CRICAPI_KEYS.length === 0) {
    console.error('No API keys found. Set API_KEY_1 env var.');
    process.exit(1);
  }

  const scores = JSON.parse(fs.readFileSync(SCORES_FILE, 'utf8'));
  const toBackfill = scores.matchHistory.filter(m => !m.scorecard || m.scorecard.length === 0);

  if (toBackfill.length === 0) {
    console.log('All matches already have scorecards.');
    process.exit(0);
  }

  console.log(`Backfilling ${toBackfill.length} match(es)...`);

  for (const match of toBackfill) {
    console.log(`\n${match.name} (${match.date})`);

    const cricMatch = findCricApiMatchId(match.name, match.date);
    if (!cricMatch) {
      console.log('  Could not find CricAPI match ID, skipping');
      continue;
    }

    console.log(`  CricAPI ID: ${cricMatch.id}`);
    try {
      const result = await fetchScorecard(cricMatch.id);
      if (!result.data?.scorecard || result.data.scorecard.length === 0) {
        console.log('  No scorecard data available');
        continue;
      }

      const scorecard = convertCricApiScorecard(result);
      match.scorecard = scorecard;

      for (const inn of scorecard) {
        console.log(`  ${inn.innings}: ${inn.runs}/${inn.wickets} (${inn.overs} ov) — ${inn.batting.length} batters, ${inn.bowling.length} bowlers`);
      }
    } catch (err) {
      console.error(`  Error: ${err.message}`);
    }
  }

  fs.writeFileSync(SCORES_FILE, JSON.stringify(scores, null, 2));
  console.log('\nScores file updated.');
}

main().then(() => process.exit(0)).catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
