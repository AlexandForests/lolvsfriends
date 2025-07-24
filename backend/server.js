const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const axios = require('axios');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100 // limit each IP to 100 requests per windowMs
});
app.use(limiter);

// Supabase client
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY
);

// Riot API configuration
const RIOT_API_KEY = process.env.RIOT_API_KEY;
const RIOT_BASE_URL = 'https://americas.api.riotgames.com'; // For match data
const RIOT_REGIONAL_URL = 'https://na1.api.riotgames.com'; // For summoner data

// Improved riot request function with better debugging
const riotRequest = async (url, retries = 3) => {
  console.log(`Making Riot API request: ${url}`);
  
  try {
    const response = await axios.get(url, {
      headers: { 
        'X-Riot-Token': RIOT_API_KEY,
        'User-Agent': 'lol-leaderboard/1.0'
      },
      timeout: 15000 // 15 second timeout
    });
    
    console.log(`API request successful: ${response.status}`);
    return response.data;
    
  } catch (error) {
    console.error(`API request failed: ${error.message}`);
    
    if (error.response) {
      console.error(`Status: ${error.response.status}`);
      console.error(`Headers:`, error.response.headers);
      console.error(`Data:`, error.response.data);
      
      if (error.response.status === 429 && retries > 0) {
        const retryAfter = error.response.headers['retry-after'] || 1;
        console.log(`Rate limited, waiting ${retryAfter} seconds...`);
        await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
        return riotRequest(url, retries - 1);
      }
    } else if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
      console.error('Network error:', error.code);
      if (retries > 0) {
        console.log(`Retrying in 2 seconds... (${retries} retries left)`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return riotRequest(url, retries - 1);
      }
    }
    
    throw error;
  }
};

// Test endpoint to check if everything is working
app.get('/api/test', (req, res) => {
  res.json({ 
    message: 'Server is working!', 
    env: {
      hasRiotKey: !!process.env.RIOT_API_KEY,
      hasSupabaseUrl: !!process.env.SUPABASE_URL,
      hasSupabaseKey: !!process.env.SUPABASE_ANON_KEY,
      riotKeyPrefix: process.env.RIOT_API_KEY ? process.env.RIOT_API_KEY.substring(0, 10) + '...' : 'NOT SET'
    }
  });
});

// Quick diagnostic endpoint to see Riot API response
app.post('/api/debug-summoner', async (req, res) => {
  try {
    const { summonerName, tagLine = 'NA1' } = req.body;
    
    // Get account info
    const accountUrl = `${RIOT_BASE_URL}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(summonerName)}/${tagLine}`;
    const account = await riotRequest(accountUrl);
    
    // Get summoner info
    const summonerUrl = `${RIOT_REGIONAL_URL}/lol/summoner/v4/summoners/by-puuid/${account.puuid}`;
    const summoner = await riotRequest(summonerUrl);
    
    // Return raw data for inspection
    res.json({
      account_response: account,
      summoner_response: summoner,
      summoner_keys: Object.keys(summoner),
      account_keys: Object.keys(account)
    });
    
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Better error handling for summoner lookup
app.post('/api/summoner', async (req, res) => {
  try {
    const { summonerName, tagLine = 'NA1' } = req.body;
    
    console.log(`Looking up summoner: ${summonerName}#${tagLine}`);
    
    // Validate inputs
    if (!summonerName) {
      return res.status(400).json({ error: 'Summoner name is required' });
    }
    
    if (!RIOT_API_KEY) {
      return res.status(500).json({ error: 'Riot API key not configured' });
    }
    
    console.log('Using API key:', RIOT_API_KEY.substring(0, 10) + '...');
    
    // First get account info by riot id
    const accountUrl = `${RIOT_BASE_URL}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(summonerName)}/${tagLine}`;
    console.log('Account URL:', accountUrl);
    
    let account;
    try {
      account = await riotRequest(accountUrl);
      console.log('Account found:', account.puuid);
    } catch (accountError) {
      console.error('Account lookup failed:', accountError.message);
      if (accountError.response?.status === 404) {
        return res.status(404).json({ error: `Summoner ${summonerName}#${tagLine} not found` });
      }
      throw accountError;
    }
    
    // Then get summoner info
    const summonerUrl = `${RIOT_REGIONAL_URL}/lol/summoner/v4/summoners/by-puuid/${account.puuid}`;
    console.log('Summoner URL:', summonerUrl);
    
    let summoner;
    try {
      summoner = await riotRequest(summonerUrl);
      console.log('Summoner response:', JSON.stringify(summoner, null, 2));
      console.log('Summoner ID:', summoner.id);
      console.log('Summoner accountId:', summoner.accountId);
    } catch (summonerError) {
      console.error('Summoner lookup failed:', summonerError.message);
      throw summonerError;
    }
    
    // Validate summoner data before storing
    if (!summoner.puuid || !summoner.summonerLevel) {
      console.error('Invalid summoner data received:', summoner);
      return res.status(500).json({ 
        error: 'Invalid summoner data from Riot API',
        details: 'Missing required fields: puuid or summonerLevel',
        received_data: summoner
      });
    }
    
    // Store/update summoner in database using modern Riot API structure
    console.log('Storing in database...');
    
    const summonerData = {
      puuid: account.puuid,
      summoner_id: summoner.puuid, // Use puuid as summoner_id since that's what we have
      account_id: summoner.puuid,  // Use puuid as account_id since that's the unique identifier
      summoner_name: account.gameName,
      tag_line: account.tagLine,
      summoner_level: summoner.summonerLevel,
      profile_icon_id: summoner.profileIconId,
      last_updated: new Date()
    };
    
    console.log('Data to insert:', JSON.stringify(summonerData, null, 2));
    
    const { data, error } = await supabase
      .from('summoners')
      .upsert(summonerData, { onConflict: 'puuid' });
    
    if (error) {
      console.error('Database error:', error);
      throw error;
    }
    
    console.log('Successfully stored summoner');
    res.json({ account, summoner });
    
  } catch (error) {
    console.error('Error fetching summoner:', {
      message: error.message,
      details: error.stack,
      hint: error.hint || '',
      code: error.code || ''
    });
    
    // Provide more helpful error messages
    if (error.message.includes('fetch failed')) {
      return res.status(500).json({ 
        error: 'Network connection failed. Check your internet connection and API key.',
        details: 'This usually means the Riot API is unreachable or your API key is invalid.'
      });
    }
    
    if (error.response?.status === 403) {
      return res.status(403).json({ 
        error: 'Invalid or expired Riot API key',
        details: 'Please check your RIOT_API_KEY in environment variables.'
      });
    }
    
    res.status(500).json({ 
      error: error.message,
      details: 'Check server logs for more information'
    });
  }
});

// Get match history for a summoner
app.get('/api/matches/:puuid', async (req, res) => {
  try {
    const { puuid } = req.params;
    const { start = 0, count = 20 } = req.query;
    
    console.log(`Fetching matches for PUUID: ${puuid}`);
    
    // Get match IDs
    const matchListUrl = `${RIOT_BASE_URL}/lol/match/v5/matches/by-puuid/${puuid}/ids?start=${start}&count=${count}`;
    const matchIds = await riotRequest(matchListUrl);
    
    console.log(`Found ${matchIds.length} match IDs`);
    
    // Get detailed match data
    const matches = [];
    for (const matchId of matchIds) {
      try {
        console.log(`Fetching match data for: ${matchId}`);
        const matchUrl = `${RIOT_BASE_URL}/lol/match/v5/matches/${matchId}`;
        const matchData = await riotRequest(matchUrl);
        matches.push(matchData);
        
        // Store match in database
        await storeMatchData(matchData);
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Error fetching match ${matchId}:`, error.message);
      }
    }
    
    console.log(`Successfully processed ${matches.length} matches`);
    res.json(matches);
  } catch (error) {
    console.error('Error fetching matches:', error);
    res.status(500).json({ error: error.message });
  }
});

// Store match data in database
const storeMatchData = async (matchData) => {
  try {
    const { info } = matchData;
    
    console.log(`Storing match data for: ${matchData.metadata.matchId}`);
    
    // Store match info
    const { error: matchError } = await supabase
      .from('matches')
      .upsert({
        match_id: matchData.metadata.matchId,
        game_creation: new Date(info.gameCreation),
        game_duration: info.gameDuration,
        game_mode: info.gameMode,
        game_type: info.gameType,
        game_version: info.gameVersion,
        map_id: info.mapId,
        queue_id: info.queueId,
        raw_data: matchData
      }, { onConflict: 'match_id' });
    
    if (matchError) {
      console.error('Error storing match:', matchError);
      throw matchError;
    }
    
    // Store participant data
    for (const participant of info.participants) {
      const { error: participantError } = await supabase
        .from('match_participants')
        .upsert({
          match_id: matchData.metadata.matchId,
          puuid: participant.puuid,
          summoner_name: participant.summonerName,
          champion_id: participant.championId,
          champion_name: participant.championName,
          team_id: participant.teamId,
          position: participant.teamPosition,
          kills: participant.kills,
          deaths: participant.deaths,
          assists: participant.assists,
          gold_earned: participant.goldEarned,
          total_damage_dealt: participant.totalDamageDealtToChampions,
          vision_score: participant.visionScore,
          wards_placed: participant.wardsPlaced,
          wards_killed: participant.wardsKilled,
          cs: participant.totalMinionsKilled + participant.neutralMinionsKilled,
          win: participant.win,
          first_blood_kill: participant.firstBloodKill,
          first_blood_assist: participant.firstBloodAssist,
          penta_kills: participant.pentaKills,
          time_spent_dead: participant.totalTimeSpentDead,
          summoner1_id: participant.summoner1Id,
          summoner2_id: participant.summoner2Id,
          raw_data: participant
        }, { onConflict: 'match_id,puuid' });
      
      if (participantError) {
        console.error('Error storing participant:', participantError);
        throw participantError;
      }
    }
    
    console.log(`Successfully stored match: ${matchData.metadata.matchId}`);
  } catch (error) {
    console.error('Error storing match data:', error);
  }
};

// Advanced meme stats calculation functions
const calculateAdvancedMemeStats = (participants) => {
  const playerMemeStats = {};
  
  participants.forEach(p => {
    const playerKey = p.puuid;
    if (!playerMemeStats[playerKey]) {
      playerMemeStats[playerKey] = {
        summonerName: p.summoner_name,
        tagLine: p.summoners?.tag_line || 'NA1',
        totalGames: 0,
        
        // Death-related memes
        firstBloodDeaths: 0,
        soloDeaths: 0,
        greedyDeaths: 0,
        
        // Flash memes
        flashGames: 0,
        suspiciousDeaths: 0,
        
        // Other stats
        backlineDeaths: 0,
        engageAttempts: 0,
        visionMemes: 0,
        highKillLowWin: 0,
        lowKillHighWin: 0,
        oneChampPony: {},
        damageTaken: 0,
        damageDealt: 0,
        lateGamePerformance: [],
        earlyGamePerformance: [],
      };
    }
    
    const stats = playerMemeStats[playerKey];
    stats.totalGames++;
    
    // Calculate meme stats
    if (p.deaths > 0 && !p.first_blood_kill && !p.first_blood_assist) {
      stats.firstBloodDeaths++;
    }
    
    const hasFlash = p.summoner1_id === 4 || p.summoner2_id === 4;
    if (hasFlash) {
      stats.flashGames++;
      if (p.deaths > 0 && p.total_damage_dealt < 10000) {
        stats.suspiciousDeaths++;
      }
    }
    
    if (p.deaths > p.assists * 0.3) {
      stats.soloDeaths++;
    }
    
    if (p.gold_earned > 12000 && p.deaths > 5) {
      stats.greedyDeaths++;
    }
    
    // Get game duration from the matches table join
    const gameDurationSeconds = p.matches?.game_duration || 1500; // Default 25 min
    if (p.vision_score < 15 && gameDurationSeconds > 1200) {
      stats.visionMemes++;
    }
    
    if (p.kills >= 10 && !p.win) {
      stats.highKillLowWin++;
    }
    if (p.kills <= 3 && p.win) {
      stats.lowKillHighWin++;
    }
    
    // Champion tracking
    if (!stats.oneChampPony[p.champion_name]) {
      stats.oneChampPony[p.champion_name] = { games: 0, performance: 0 };
    }
    stats.oneChampPony[p.champion_name].games++;
    stats.oneChampPony[p.champion_name].performance += (p.kills + p.assists) - p.deaths;
    
    if ((p.position === 'BOTTOM' || p.position === 'MIDDLE') && p.deaths > 6) {
      stats.backlineDeaths++;
    }
    
    stats.damageDealt += p.total_damage_dealt;
    
    const gameDurationMinutes = gameDurationSeconds / 60;
    const gamePerformance = {
      kda: (p.kills + p.assists) / Math.max(p.deaths, 1),
      damageShare: p.total_damage_dealt,
      win: p.win
    };
    
    if (gameDurationMinutes > 30) {
      stats.lateGamePerformance.push(gamePerformance);
    } else if (gameDurationMinutes < 20) {
      stats.earlyGamePerformance.push(gamePerformance);
    }
  });
  
  return Object.values(playerMemeStats).map(stats => {
    const mostPlayedChamp = Object.entries(stats.oneChampPony)
      .sort((a, b) => b[1].games - a[1].games)[0];
    
    return {
      ...stats,
      firstBloodVictimRate: ((stats.firstBloodDeaths / stats.totalGames) * 100).toFixed(1),
      soloDeathRate: ((stats.soloDeaths / stats.totalGames) * 100).toFixed(1),
      greedyDeathRate: ((stats.greedyDeaths / stats.totalGames) * 100).toFixed(1),
      flashIntoWallRate: stats.flashGames > 0 ? 
        ((stats.suspiciousDeaths / stats.flashGames) * 100).toFixed(1) : '0.0',
      backlineIntRate: ((stats.backlineDeaths / stats.totalGames) * 100).toFixed(1),
      wardSlackRate: ((stats.visionMemes / stats.totalGames) * 100).toFixed(1),
      carriageRate: ((stats.highKillLowWin / stats.totalGames) * 100).toFixed(1),
      carriedRate: ((stats.lowKillHighWin / stats.totalGames) * 100).toFixed(1),
      oneChampPonyName: mostPlayedChamp ? mostPlayedChamp[0] : 'None',
      oneChampPonyRate: mostPlayedChamp ? 
        ((mostPlayedChamp[1].games / stats.totalGames) * 100).toFixed(1) : '0.0',
      championPoolSize: Object.keys(stats.oneChampPony).length,
      lateGameWinRate: stats.lateGamePerformance.length > 0 ? 
        ((stats.lateGamePerformance.filter(g => g.win).length / stats.lateGamePerformance.length) * 100).toFixed(1) : 'N/A',
      earlyGameWinRate: stats.earlyGamePerformance.length > 0 ? 
        ((stats.earlyGamePerformance.filter(g => g.win).length / stats.earlyGamePerformance.length) * 100).toFixed(1) : 'N/A',
      avgDamagePerGame: Math.round(stats.damageDealt / stats.totalGames),
    };
  });
};

// Calculate basic leaderboard stats
const calculateLeaderboardStats = (participants) => {
  const playerStats = {};
  
  participants.forEach(p => {
    const playerKey = p.puuid;
    if (!playerStats[playerKey]) {
      playerStats[playerKey] = {
        summonerName: p.summoner_name,
        tagLine: p.summoners?.tag_line || 'NA1',
        totalGames: 0,
        wins: 0,
        kills: 0,
        deaths: 0,
        assists: 0,
        firstBloodDeaths: 0,
        pentaKills: 0,
        totalTimeSpentDead: 0,
        wardsPlaced: 0,
        visionScore: 0,
        champions: new Set(),
        positions: {},
        flashIntoWallDeaths: 0,
        soloKills: 0,
        totalDamage: 0,
        goldEarned: 0,
        cs: 0
      };
    }
    
    const stats = playerStats[playerKey];
    stats.totalGames++;
    stats.wins += p.win ? 1 : 0;
    stats.kills += p.kills;
    stats.deaths += p.deaths;
    stats.assists += p.assists;
    stats.firstBloodDeaths += (p.deaths > 0 && !p.first_blood_kill && !p.first_blood_assist) ? 1 : 0;
    stats.pentaKills += p.penta_kills;
    stats.totalTimeSpentDead += p.time_spent_dead;
    stats.wardsPlaced += p.wards_placed;
    stats.visionScore += p.vision_score;
    stats.champions.add(p.champion_name);
    stats.totalDamage += p.total_damage_dealt;
    stats.goldEarned += p.gold_earned;
    stats.cs += p.cs;
    
    // Track position stats
    if (p.position) {
      if (!stats.positions[p.position]) {
        stats.positions[p.position] = { games: 0, wins: 0 };
      }
      stats.positions[p.position].games++;
      stats.positions[p.position].wins += p.win ? 1 : 0;
    }
    
    // Estimate flash into wall deaths (deaths with flash up + low damage taken)
    if (p.deaths > 0 && (p.summoner1_id === 4 || p.summoner2_id === 4)) {
      stats.flashIntoWallDeaths += Math.floor(Math.random() * 0.3); // Placeholder logic
    }
  });
  
  // Convert to array and calculate final stats
  const leaderboard = Object.values(playerStats).map(stats => ({
    ...stats,
    championPoolSize: stats.champions.size,
    winRate: (stats.wins / stats.totalGames * 100).toFixed(1),
    kda: ((stats.kills + stats.assists) / Math.max(stats.deaths, 1)).toFixed(2),
    avgKills: (stats.kills / stats.totalGames).toFixed(1),
    avgDeaths: (stats.deaths / stats.totalGames).toFixed(1),
    avgAssists: (stats.assists / stats.totalGames).toFixed(1),
    firstBloodVictimRate: (stats.firstBloodDeaths / stats.totalGames * 100).toFixed(1),
    avgTimeSpentDead: (stats.totalTimeSpentDead / stats.totalGames).toFixed(0),
    avgWardsPerGame: (stats.wardsPlaced / stats.totalGames).toFixed(1),
    avgVisionScore: (stats.visionScore / stats.totalGames).toFixed(1),
    pentaKillRate: (stats.pentaKills / stats.totalGames * 100).toFixed(2),
    flashIntoWallRate: (stats.flashIntoWallDeaths / stats.totalGames * 100).toFixed(1),
    avgDamagePerGame: Math.round(stats.totalDamage / stats.totalGames),
    avgGoldPerGame: Math.round(stats.goldEarned / stats.totalGames),
    avgCSPerGame: (stats.cs / stats.totalGames).toFixed(1),
    positionWinRates: Object.fromEntries(
      Object.entries(stats.positions).map(([pos, data]) => [
        pos, 
        (data.wins / data.games * 100).toFixed(1)
      ])
    )
  }));
  
  return leaderboard;
};

// Get leaderboard stats - simplified version
app.get('/api/leaderboard', async (req, res) => {
  try {
    console.log('Fetching leaderboard data...');
    
    // Use the database function we created
    const { data: participants, error } = await supabase
      .rpc('get_friend_match_data');
    
    if (error) {
      console.error('Database error:', error);
      throw error;
    }
    
    console.log(`Found ${participants.length} participant records`);
    
    // Transform data to match expected format for calculateLeaderboardStats
    const transformedData = participants.map(p => ({
      ...p,
      summoners: {
        summoner_name: p.summoner_name,
        tag_line: p.tag_line
      },
      matches: {
        game_duration: p.game_duration,
        game_mode: p.game_mode,
        queue_id: p.queue_id
      }
    }));
    
    // Calculate stats
    const stats = calculateLeaderboardStats(transformedData);
    
    console.log(`Calculated stats for ${stats.length} players`);
    res.json(stats);
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get meme leaderboard stats - simplified version
app.get('/api/meme-leaderboard', async (req, res) => {
  try {
    console.log('Fetching meme leaderboard data...');
    
    // Use the database function we created
    const { data: participants, error } = await supabase
      .rpc('get_friend_match_data');
    
    if (error) {
      console.error('Database error:', error);
      throw error;
    }
    
    console.log(`Found ${participants.length} participant records for meme stats`);
    
    // Transform data to match expected format for calculateAdvancedMemeStats
    const transformedData = participants.map(p => ({
      ...p,
      summoners: {
        summoner_name: p.summoner_name,
        tag_line: p.tag_line
      },
      matches: {
        game_duration: p.game_duration,
        game_mode: p.game_mode,
        queue_id: p.queue_id
      }
    }));
    
    const memeStats = calculateAdvancedMemeStats(transformedData);
    
    // Generate leaderboards
    const leaderboards = {
      mostLikelyToDieFirst: [...memeStats]
        .sort((a, b) => parseFloat(b.firstBloodVictimRate) - parseFloat(a.firstBloodVictimRate))
        .slice(0, 5),
      
      flashIntoWallKing: [...memeStats]
        .sort((a, b) => parseFloat(b.flashIntoWallRate) - parseFloat(a.flashIntoWallRate))
        .slice(0, 5),
      
      soloDeathSpecialist: [...memeStats]
        .sort((a, b) => parseFloat(b.soloDeathRate) - parseFloat(a.soloDeathRate))
        .slice(0, 5),
      
      bestCarriagePotential: [...memeStats]
        .sort((a, b) => parseFloat(b.carriageRate) - parseFloat(a.carriageRate))
        .slice(0, 5),
      
      mostCarried: [...memeStats]
        .sort((a, b) => parseFloat(b.carriedRate) - parseFloat(a.carriedRate))
        .slice(0, 5),
      
      biggestOneChampPony: [...memeStats]
        .sort((a, b) => parseFloat(b.oneChampPonyRate) - parseFloat(a.oneChampPonyRate))
        .slice(0, 5),
      
      mostVersatile: [...memeStats]
        .sort((a, b) => b.championPoolSize - a.championPoolSize)
        .slice(0, 5),
    };
    
    console.log(`Generated meme stats for ${memeStats.length} players`);
    res.json({
      playerStats: memeStats,
      leaderboards: leaderboards
    });
  } catch (error) {
    console.error('Error fetching meme leaderboard:', error);
    res.status(500).json({ error: error.message });
  }
});

// Bulk update matches for all friends
app.post('/api/update-all-matches', async (req, res) => {
  try {
    const { friendsList } = req.body; // Array of { summonerName, tagLine }
    
    console.log(`Starting bulk update for ${friendsList.length} friends`);
    
    const results = [];
    
    for (const friend of friendsList) {
      try {
        console.log(`Processing ${friend.summonerName}#${friend.tagLine}`);
        
        // Get summoner info
        const accountUrl = `${RIOT_BASE_URL}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(friend.summonerName)}/${friend.tagLine}`;
        const account = await riotRequest(accountUrl);
        
        // Get recent matches
        const matchListUrl = `${RIOT_BASE_URL}/lol/match/v5/matches/by-puuid/${account.puuid}/ids?start=0&count=10`;
        const matchIds = await riotRequest(matchListUrl);
        
        let newMatches = 0;
        for (const matchId of matchIds) {
          try {
            const matchUrl = `${RIOT_BASE_URL}/lol/match/v5/matches/${matchId}`;
            const matchData = await riotRequest(matchUrl);
            await storeMatchData(matchData);
            newMatches++;
            
            // Rate limiting delay
            await new Promise(resolve => setTimeout(resolve, 150));
          } catch (error) {
            console.error(`Error processing match ${matchId}:`, error.message);
          }
        }
        
        results.push({
          summoner: friend.summonerName,
          matchesProcessed: newMatches,
          status: 'success'
        });
        
        console.log(`Completed ${friend.summonerName}: ${newMatches} matches processed`);
        
      } catch (error) {
        console.error(`Error updating matches for ${friend.summonerName}:`, error.message);
        results.push({
          summoner: friend.summonerName,
          error: error.message,
          status: 'error'
        });
      }
    }
    
    console.log(`Bulk update completed. ${results.filter(r => r.status === 'success').length}/${results.length} successful`);
    res.json({ results });
  } catch (error) {
    console.error('Error in bulk update:', error);
    res.status(500).json({ error: error.message });
  }
});

// Quick refresh endpoint for your friend group
app.post('/api/refresh-friends', async (req, res) => {
  try {
    // Get all existing summoners from database
    const { data: summoners, error } = await supabase
      .from('summoners')
      .select('summoner_name, tag_line, puuid');
    
    if (error) throw error;
    
    console.log(`Refreshing data for ${summoners.length} friends...`);
    
    const results = [];
    
    for (const summoner of summoners) {
      try {
        // Get recent matches for each friend
        const matchListUrl = `${RIOT_BASE_URL}/lol/match/v5/matches/by-puuid/${summoner.puuid}/ids?start=0&count=5`;
        const matchIds = await riotRequest(matchListUrl);
        
        let newMatches = 0;
        for (const matchId of matchIds) {
          try {
            const matchUrl = `${RIOT_BASE_URL}/lol/match/v5/matches/${matchId}`;
            const matchData = await riotRequest(matchUrl);
            await storeMatchData(matchData);
            newMatches++;
            
            // Rate limiting delay
            await new Promise(resolve => setTimeout(resolve, 200));
          } catch (error) {
            console.error(`Error processing match ${matchId}:`, error.message);
          }
        }
        
        results.push({
          summoner: `${summoner.summoner_name}#${summoner.tag_line}`,
          matchesProcessed: newMatches,
          status: 'success'
        });
        
        console.log(`Completed ${summoner.summoner_name}: ${newMatches} matches`);
        
      } catch (error) {
        console.error(`Error updating ${summoner.summoner_name}:`, error.message);
        results.push({
          summoner: `${summoner.summoner_name}#${summoner.tag_line}`,
          error: error.message,
          status: 'error'
        });
      }
    }
    
    res.json({ 
      message: `Refresh completed for ${summoners.length} friends`,
      results 
    });
  } catch (error) {
    console.error('Error in refresh:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log('Environment check:');
  console.log(`- Riot API Key: ${RIOT_API_KEY ? '✅ Set' : '❌ Missing'}`);
  console.log(`- Supabase URL: ${process.env.SUPABASE_URL ? '✅ Set' : '❌ Missing'}`);
  console.log(`- Supabase Key: ${process.env.SUPABASE_ANON_KEY ? '✅ Set' : '❌ Missing'}`);
});