// Cricbuzz scorecard scraper.
// Fetches scorecard HTML from Cricbuzz and parses batting/bowling data.
// Returns the same structure as convertCricApiScorecard() for drop-in use.

const https = require('https');

const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

// Map of ESPN match IDs to Cricbuzz match IDs.
// Cricbuzz IDs found by scraping the series page + probing sequential IDs.
const ESPN_TO_CRICBUZZ = {
  'espn_1527674': 149618,  // RCB vs SRH, Match 1
  'espn_1527675': 149629,  // MI vs KKR, Match 2
  'espn_1527676': 149640,  // RR vs CSK, Match 3
  'espn_1527677': 149651,  // PBKS vs GT, Match 4
  'espn_1527678': 149662,  // LSG vs DC, Match 5
  'espn_1527679': 149673,  // KKR vs SRH, Match 6
  'espn_1527680': 149684,  // CSK vs PBKS, Match 7
};

function fetchHTML(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'User-Agent': USER_AGENT,
        'Accept': 'text/html',
      },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchHTML(res.headers.location).then(resolve, reject);
        return;
      }
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// Parse the Cricbuzz scorecard HTML into structured innings data.
// Returns array of innings objects: { innings, runs, wickets, overs, batting[], bowling[] }
function parseScorecardHTML(html) {
  const innings = [];

  // Find innings sections: id="scard-team-XXX-innings-N"
  // Page has duplicate sections (mobile + desktop). We take only the first of each
  // unique team-innings key, but use ALL positions as section boundaries so we don't
  // accidentally parse across into the next section or its duplicate.
  const allScardPositions = [];
  const allScardPattern = /id="scard-team-/g;
  let am;
  while ((am = allScardPattern.exec(html)) !== null) {
    allScardPositions.push(am.index);
  }

  const sectionPattern = /id="scard-(team-(\d+)-innings-(\d+))"/g;
  const seenKeys = new Set();
  const sections = [];
  let m;
  while ((m = sectionPattern.exec(html)) !== null) {
    const key = `${m[2]}-${m[3]}`;
    if (seenKeys.has(key)) continue;  // skip duplicate (mobile/desktop)
    seenKeys.add(key);
    // Find next scard section (any, including duplicates) after this one
    let nextPos = m.index + 50000;
    for (const p of allScardPositions) {
      if (p > m.index) { nextPos = p; break; }
    }
    sections.push({ fullId: m[1], teamId: m[2], inningsNum: m[3], pos: m.index, end: nextPos });
  }

  for (let i = 0; i < sections.length; i++) {
    const sec = sections[i];
    const sectionStart = sec.pos;
    const sectionEnd = sec.end;
    // Also look before the section for team name + total
    const beforeStart = Math.max(0, sectionStart - 500);
    const before = html.substring(beforeStart, sectionStart);
    const sectionHtml = html.substring(sectionStart, Math.min(sectionEnd, html.length));

    // Extract team name from before the section
    const teamMatch = before.match(/>([^<]{3,}?)\s*<\/div>\s*<div[^>]*>\s*<div>\s*<span[^>]*font-bold[^>]*>(\d+)-(\d+)<\/span>\s*<span>.*?\((\d+(?:\.\d+)?)\s*Ov\)/s);
    let teamName = '';
    let totalRuns = 0;
    let totalWickets = 0;
    let totalOvers = 0;
    if (teamMatch) {
      teamName = teamMatch[1].replace(/<!--.*?-->/g, '').trim();
      totalRuns = parseInt(teamMatch[2]) || 0;
      totalWickets = parseInt(teamMatch[3]) || 0;
      totalOvers = parseFloat(teamMatch[4]) || 0;
    } else {
      // Fallback: extract team name and total separately
      const tnMatch = before.match(/>([A-Z][a-zA-Z ]+(?:Bengaluru|Hyderabad|Indians|Riders|Kings|Capitals|Royals|Titans|Giants|Super Kings))\s*</);
      if (tnMatch) teamName = tnMatch[1].trim();
      const totMatch = before.match(/<span[^>]*font-bold[^>]*>(\d+)-(\d+)<\/span>\s*<span>.*?\((\d+(?:\.\d+)?)\s*Ov\)/s);
      if (totMatch) {
        totalRuns = parseInt(totMatch[1]) || 0;
        totalWickets = parseInt(totMatch[2]) || 0;
        totalOvers = parseFloat(totMatch[3]) || 0;
      }
    }

    // Parse batting entries from scorecard-bat-grid divs
    const batting = [];
    // Each batter: <a href="/profiles/ID/slug">Name</a> followed by dismissal text, then R, B, 4s, 6s, SR
    const batterPattern = /<a\s+href="\/profiles\/\d+\/[^"]*"[^>]*>([^<]+)<\/a>\s*<div[^>]*text-cbTxtSec[^>]*>([^<]*)<\/div>\s*<\/div>\s*<div[^>]*>(\d+)<\/div>\s*<div[^>]*>(\d+)<\/div>\s*<div[^>]*>(\d+)<\/div>\s*<div[^>]*>(\d+)<\/div>\s*<div[^>]*>([\d.]+)<\/div>/g;
    let bm;
    while ((bm = batterPattern.exec(sectionHtml)) !== null) {
      const name = bm[1].replace(/\s*\((?:wk|c|c & wk|c &amp; wk)\)\s*/g, '').trim();
      const dismissal = bm[2].replace(/<!--.*?-->/g, '').replace(/&amp;/g, '&').trim() || 'not out';
      batting.push({
        name,
        runs: parseInt(bm[3]) || 0,
        balls: parseInt(bm[4]) || 0,
        fours: parseInt(bm[5]) || 0,
        sixes: parseInt(bm[6]) || 0,
        sr: parseFloat(bm[7]) || 0,
        dismissal,
      });
    }

    // Parse bowling entries from scorecard-bowl-grid divs
    const bowling = [];
    const bowlerPattern = /<a\s+href="\/profiles\/\d+\/[^"]*"[^>]*class="text-cbTextLink[^>]*>([^<]+)<\/a>\s*<div[^>]*>(\d+(?:\.\d+)?)<\/div>\s*<div[^>]*>(\d+)<\/div>\s*<div[^>]*>(\d+)<\/div>\s*<div[^>]*>(\d+)<\/div>/g;
    let bwm;
    while ((bwm = bowlerPattern.exec(sectionHtml)) !== null) {
      const name = bwm[1].replace(/\s*\((?:wk|c|c & wk|c &amp; wk)\)\s*/g, '').trim();
      const overs = parseFloat(bwm[2]) || 0;
      const maidens = parseInt(bwm[3]) || 0;
      const runs = parseInt(bwm[4]) || 0;
      const wickets = parseInt(bwm[5]) || 0;
      // Economy is after wickets + NB + WD (hidden divs)
      // Extract it separately
      bowling.push({ name, overs, maidens, runs, wickets, economy: 0 });
    }

    // Fill in economy for bowlers (runs / overs)
    for (const b of bowling) {
      if (b.overs > 0) {
        // Convert overs to actual balls: 2.3 overs = 2*6+3 = 15 balls = 2.5 actual overs
        const fullOvers = Math.floor(b.overs);
        const partialBalls = Math.round((b.overs - fullOvers) * 10);
        const totalBalls = fullOvers * 6 + partialBalls;
        b.economy = totalBalls > 0 ? parseFloat((b.runs / (totalBalls / 6)).toFixed(2)) : 0;
      }
    }

    innings.push({
      innings: teamName,
      runs: totalRuns,
      wickets: totalWickets,
      overs: totalOvers,
      batting,
      bowling,
    });
  }

  return innings;
}

// Extract match result/status from the HTML
function parseMatchStatus(html) {
  // Look for "won by" text
  const wonMatch = html.match(/>([^<]*won by[^<]*)</);
  if (wonMatch) return wonMatch[1].trim();
  // Look for other status
  const statusMatch = html.match(/>([^<]*(?:Match tied|No result|Match abandoned|Match drawn)[^<]*)</);
  if (statusMatch) return statusMatch[1].trim();
  return '';
}

// Fetch and parse a Cricbuzz scorecard by Cricbuzz match ID.
// Returns { scorecard: [...innings], status: string } or null on failure.
async function fetchCricbuzzScorecard(cricbuzzId) {
  const url = `https://www.cricbuzz.com/live-cricket-scorecard/${cricbuzzId}/match`;
  try {
    console.log(`  Fetching Cricbuzz scorecard: ${url}`);
    const html = await fetchHTML(url);
    if (!html || html.length < 1000) {
      console.log(`  Empty or too-short response from Cricbuzz`);
      return null;
    }
    const scorecard = parseScorecardHTML(html);
    const status = parseMatchStatus(html);
    if (scorecard.length === 0) {
      console.log(`  No innings found in Cricbuzz scorecard`);
      return null;
    }
    console.log(`  Parsed ${scorecard.length} innings from Cricbuzz`);
    for (const inn of scorecard) {
      console.log(`    ${inn.innings}: ${inn.runs}/${inn.wickets} (${inn.overs} ov) — ${inn.batting.length} batters, ${inn.bowling.length} bowlers`);
    }
    return { scorecard, status };
  } catch (err) {
    console.log(`  Cricbuzz fetch error: ${err.message}`);
    return null;
  }
}

// Persistent map file for runtime-discovered Cricbuzz IDs.
const CRICBUZZ_MAP_FILE = require('path').join(__dirname, '..', 'data', 'cricbuzz_map.json');

function loadCricbuzzMap() {
  try {
    return JSON.parse(require('fs').readFileSync(CRICBUZZ_MAP_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveCricbuzzMap(map) {
  require('fs').writeFileSync(CRICBUZZ_MAP_FILE, JSON.stringify(map, null, 2));
}

// Look up a Cricbuzz match ID from an ESPN match ID.
// Checks hardcoded map first, then persistent discovered map.
function getCricbuzzId(espnMatchId) {
  if (ESPN_TO_CRICBUZZ[espnMatchId]) return ESPN_TO_CRICBUZZ[espnMatchId];
  const discovered = loadCricbuzzMap();
  return discovered[espnMatchId] || null;
}

// IPL team name abbreviations used in Cricbuzz URL slugs
const TEAM_SLUGS = {
  'Royal Challengers Bengaluru': 'rcb', 'Sunrisers Hyderabad': 'srh',
  'Mumbai Indians': 'mi', 'Kolkata Knight Riders': 'kkr',
  'Rajasthan Royals': 'rr', 'Chennai Super Kings': 'csk',
  'Punjab Kings': 'pbks', 'Gujarat Titans': 'gt',
  'Delhi Capitals': 'dc', 'Lucknow Super Giants': 'lsg',
};

// Try to discover a Cricbuzz match ID for an ESPN event by probing IDs near known ones.
// espnMatchId: "espn_NNNNNNN", eventName: "Team A v Team B"
async function discoverCricbuzzId(espnMatchId, eventName) {
  // Already known?
  const existing = getCricbuzzId(espnMatchId);
  if (existing) return existing;

  // Extract team names from event name ("Team A v Team B")
  const teams = eventName.split(/\s+v\s+/i).map(t => t.trim());
  if (teams.length !== 2) return null;

  // Build expected slug fragments
  const slugFragments = teams.map(t => {
    for (const [full, abbr] of Object.entries(TEAM_SLUGS)) {
      if (t.toLowerCase().includes(full.toLowerCase().split(' ')[0])) return abbr;
    }
    return t.toLowerCase().split(' ')[0];
  });

  // Find the highest known Cricbuzz ID to start probing from
  const allKnown = { ...ESPN_TO_CRICBUZZ, ...loadCricbuzzMap() };
  let maxId = Math.max(...Object.values(allKnown).filter(v => typeof v === 'number'));
  if (!isFinite(maxId)) maxId = 149684;

  console.log(`  Discovering Cricbuzz ID for "${eventName}" (probing from ${maxId})`);

  // Probe IDs in a range around the max known ID (Cricbuzz IDs increment by ~11 per match)
  for (let offset = 0; offset <= 55; offset += 11) {
    for (const delta of [offset, -offset]) {
      const probeId = maxId + delta;
      if (probeId <= 0) continue;
      if (Object.values(allKnown).includes(probeId)) continue;

      try {
        const url = `https://www.cricbuzz.com/live-cricket-scorecard/${probeId}/match`;
        const html = await fetchHTML(url);
        if (!html || html.length < 1000) continue;

        // Check if this page is for our match by looking for both team slugs in the URL/title
        const titleMatch = html.match(/<title>([^<]+)<\/title>/);
        const title = (titleMatch ? titleMatch[1] : '').toLowerCase();

        const matchesTeams = slugFragments.every(frag => title.includes(frag));
        if (matchesTeams && title.includes('ipl')) {
          console.log(`  Discovered Cricbuzz ID ${probeId} for "${eventName}"`);
          const map = loadCricbuzzMap();
          map[espnMatchId] = probeId;
          saveCricbuzzMap(map);
          return probeId;
        }
      } catch (e) {
        // Probe failed, continue
      }
    }
  }

  console.log(`  Could not discover Cricbuzz ID for "${eventName}"`);
  return null;
}

module.exports = { fetchCricbuzzScorecard, getCricbuzzId, discoverCricbuzzId, parseScorecardHTML, parseMatchStatus, ESPN_TO_CRICBUZZ };
