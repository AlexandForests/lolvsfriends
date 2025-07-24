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

// Helper function to make Riot API requests with rate limiting
const riotRequest = async (url, retries = 3) => {
  try {
    const response = await axios.get(url, {
      headers: { 'X-Riot-Token': RIOT_API_KEY },
      timeout: 10000
    });
    return response.data;
  } catch (error) {
    if (error.response?.status === 429 && retries > 0) {
      // Rate limited, wait and retry
      const retryAfter = error.response.headers['retry-after'] || 1;
      console.log(`Rate limited, waiting ${retryAfter} seconds...`);
      await new Promise(resolve => setTimeout(resolve, retryAfter * 1000));
      return riotRequest(url, retries - 1);
    }
    throw error;
  }
};

// Get summoner by name
app.post('/api/summoner', async (req, res) => {
  try {
    const { summonerName, tagLine = 'NA1' } = req.body;
    
    // First get account info by riot id
    const accountUrl = `${RIOT_BASE_URL}/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(summonerName)}/${tagLine}`;
    const account = await riotRequest(accountUrl);
    
    // Then get summoner info
    const summonerUrl = `${RIOT_REGIONAL_URL}/lol/summoner/v4/summoners/by-puuid/${account.puuid}`;
    const summoner = await riotRequest(summonerUrl);
    
    // Store/update summoner in database
    const { data, error } = await supabase
      .from('summoners')
      .upsert({
        puuid: account.puuid,
        summoner_id: summoner.id,
        account_id: summoner.accountId,
        summoner_name: account.gameName,
        tag_line: account.tagLine,
        summoner_level: summoner.summonerLevel,
        profile_icon_id: summoner.profileIconId,
        last_updated: new Date()
      }, { onConflict: 'puuid' });
    
    if (error) throw error;
    
    res.json({ account, summoner });
  } catch (error) {
    console.error('Error fetching summoner:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get match history for a summoner
app.get('/api/matches/:puuid', async (req, res) => {
  try {
    const { puuid } = req.params;
    const { start = 0, count = 20 } = req.query;
    
    // Get match IDs
    const matchListUrl = `${RIOT_BASE_URL}/lol/match/v5/matches/by-puuid/${puuid}/ids?start=${start}&count=${count}`;
    const matchIds = await riotRequest(matchListUrl);
    
    // Get detailed match data
    const matches = [];
    for (const matchId of matchIds) {
      try {
        const matchUrl = `${RIOT_BASE_URL}/lol/match/v5/matches/${matchId}`;
        const matchData = await riotRequest(matchUrl);
        matches.push(matchData);
        
        // Store match in database
        await storeMatchData(matchData);
        
        // Small delay to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 100));
      } catch (error) {
        console.error(`Error fetching match ${matchId}:`, error);
      }
    }
    
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
    
    if (matchError) throw matchError;
    
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
      
      if (participantError) throw participantError;
    }
  } catch (error) {
    console.error('Error storing match data:', error);
  }
};

// Get leaderboard stats
app.get('/api/leaderboard', async (req, res) => {
  try {
    const { data: participants, error } = await supabase
      .from('match_participants')
      .select(`
        *,
        summoners!inner(summoner_name, tag_line),
        matches!inner(game_duration, game_mode, queue_id)
      `);
    
    if (error) throw error;
    
    // Calculate stats
    const stats = calculateLeaderboardStats(participants);
    
    res.json(stats);
  } catch (error) {
    console.error('Error fetching leaderboard:', error);
    res.status(500).json({ error: error.message });
  }
});

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

// Calculate meme and serious stats
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
        flashIntoWallDeaths: 0, // We'll calculate this based on summoner spells + death location
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
    if (p.deaths > 0 && p.summoner1_id === 4 || p.summoner2_id === 4) {
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

// Bulk update matches for all friends
app.post('/api/update-all-matches', async (req, res) => {
  try {
    const { friendsList } = req.body; // Array of { summonerName, tagLine }
    
    const results = [];
    
    for (const friend of friendsList) {
      try {
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
            console.error(`Error processing match ${matchId}:`, error);
          }
        }
        
        results.push({
          summoner: friend.summonerName,
          matchesProcessed: newMatches,
          status: 'success'
        });
        
      } catch (error) {
        console.error(`Error updating matches for ${friend.summonerName}:`, error);
        results.push({
          summoner: friend.summonerName,
          error: error.message,
          status: 'error'
        });
      }
    }
    
    res.json({ results });
  } catch (error) {
    console.error('Error in bulk update:', error);
    res.status(500).json({ error: error.message });
  }
});

// Get meme leaderboard stats
app.get('/api/meme-leaderboard', async (req, res) => {
  try {
    const { data: participants, error } = await supabase
      .from('match_participants')
      .select(`
        *,
        summoners!inner(summoner_name, tag_line),
        matches!inner(game_duration, game_mode, queue_id)
      `);
    
    if (error) throw error;
    
    const memeStats = calculateAdvancedMemeStats(participants);
    
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
    
    res.json({
      playerStats: memeStats,
      leaderboards: leaderboards
    });
  } catch (error) {
    console.error('Error fetching meme leaderboard:', error);
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});