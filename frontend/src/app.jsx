import React, { useState, useEffect } from 'react';
import { Trophy, Users, Zap, Target, Skull, Crown, Shield, Swords } from 'lucide-react';

const API_BASE = 'https://lolvsfriends-backend.onrender.com';

function App() {
  const [leaderboardData, setLeaderboardData] = useState([]);
  const [memeData, setMemeData] = useState({ playerStats: [], leaderboards: {} });
  const [activeTab, setActiveTab] = useState('serious');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  // Fetch data from backend using native fetch
  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [leaderboardRes, memeRes] = await Promise.all([
        fetch(`${API_BASE}/api/leaderboard`),
        fetch(`${API_BASE}/api/meme-leaderboard`)
      ]);
      
      if (!leaderboardRes.ok || !memeRes.ok) {
        throw new Error('Failed to fetch data');
      }
      
      const leaderboardData = await leaderboardRes.json();
      const memeDataResponse = await memeRes.json();
      
      setLeaderboardData(leaderboardData);
      setMemeData(memeDataResponse);
      setLastUpdated(new Date());
    } catch (err) {
      setError('Failed to fetch data. Please try again.');
      console.error('Error fetching data:', err);
    } finally {
      setLoading(false);
    }
  };

  // Refresh friends data
  const refreshData = async () => {
    setLoading(true);
    try {
      const refreshRes = await fetch(`${API_BASE}/api/refresh-friends`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
      });
      
      if (!refreshRes.ok) {
        throw new Error('Failed to refresh data');
      }
      
      await fetchData();
    } catch (err) {
      setError('Failed to refresh data. Please try again.');
      console.error('Error refreshing data:', err);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading && !leaderboardData.length) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-yellow-400 mx-auto mb-4"></div>
          <h2 className="text-2xl font-bold text-white mb-2">Loading Leaderboard</h2>
          <p className="text-gray-300">Analyzing your friend group's performance...</p>
        </div>
      </div>
    );
  }

  if (error && !leaderboardData.length) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900 flex items-center justify-center">
        <div className="text-center max-w-md p-8 bg-red-900/20 rounded-lg border border-red-500/20">
          <Skull className="w-16 h-16 text-red-400 mx-auto mb-4" />
          <h2 className="text-2xl font-bold text-white mb-2">Failed to Load</h2>
          <p className="text-gray-300 mb-4">{error}</p>
          <button 
            onClick={fetchData}
            className="bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-lg transition-colors"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-900 via-purple-900 to-indigo-900">
      {/* Header */}
      <header className="bg-black/20 backdrop-blur-sm border-b border-white/10">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="text-center sm:text-left">
              <h1 className="text-3xl sm:text-4xl font-bold text-white mb-2">
                <Crown className="inline w-8 h-8 text-yellow-400 mr-2" />
                League Friends Leaderboard
              </h1>
              <p className="text-gray-300">Who's really carrying this friend group?</p>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-3">
              <button
                onClick={refreshData}
                disabled={loading}
                className="bg-green-600 hover:bg-green-700 disabled:bg-gray-600 text-white px-4 py-2 rounded-lg transition-colors flex items-center gap-2"
              >
                <Zap className="w-4 h-4" />
                {loading ? 'Updating...' : 'Refresh Data'}
              </button>
              
              {lastUpdated && (
                <div className="text-sm text-gray-400 flex items-center">
                  Last updated: {lastUpdated.toLocaleTimeString()}
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="max-w-7xl mx-auto px-4 py-6">
        <div className="flex flex-wrap gap-2 mb-8">
          <button
            onClick={() => setActiveTab('serious')}
            className={`px-6 py-3 rounded-lg font-semibold transition-all flex items-center gap-2 ${
              activeTab === 'serious'
                ? 'bg-blue-600 text-white shadow-lg scale-105'
                : 'bg-white/10 text-gray-300 hover:bg-white/20'
            }`}
          >
            <Trophy className="w-5 h-5" />
            Serious Stats
          </button>
          <button
            onClick={() => setActiveTab('memes')}
            className={`px-6 py-3 rounded-lg font-semibold transition-all flex items-center gap-2 ${
              activeTab === 'memes'
                ? 'bg-purple-600 text-white shadow-lg scale-105'
                : 'bg-white/10 text-gray-300 hover:bg-white/20'
            }`}
          >
            <Skull className="w-5 h-5" />
            Meme Stats
          </button>
        </div>

        {/* Content */}
        {activeTab === 'serious' ? (
          <SeriousLeaderboard data={leaderboardData} />
        ) : (
          <MemeLeaderboard data={memeData} />
        )}
      </div>
    </div>
  );
}

// Serious Stats Component
function SeriousLeaderboard({ data }) {
  const sortedData = [...data].sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate));

  return (
    <div className="space-y-6">
      {/* Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
          <div className="flex items-center gap-3 mb-3">
            <Users className="w-8 h-8 text-blue-400" />
            <h3 className="text-xl font-bold text-white">Players</h3>
          </div>
          <p className="text-3xl font-bold text-blue-400">{data.length}</p>
        </div>
        
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
          <div className="flex items-center gap-3 mb-3">
            <Target className="w-8 h-8 text-green-400" />
            <h3 className="text-xl font-bold text-white">Total Games</h3>
          </div>
          <p className="text-3xl font-bold text-green-400">
            {data.reduce((sum, player) => sum + parseInt(player.totalGames), 0)}
          </p>
        </div>
        
        <div className="bg-white/10 backdrop-blur-sm rounded-lg p-6 border border-white/20">
          <div className="flex items-center gap-3 mb-3">
            <Crown className="w-8 h-8 text-yellow-400" />
            <h3 className="text-xl font-bold text-white">Best Win Rate</h3>
          </div>
          <p className="text-3xl font-bold text-yellow-400">
            {sortedData[0]?.winRate}%
          </p>
          <p className="text-sm text-gray-300">{sortedData[0]?.summonerName}</p>
        </div>
      </div>

      {/* Main Leaderboard */}
      <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 overflow-hidden">
        <div className="p-6 bg-white/5 border-b border-white/20">
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Trophy className="w-6 h-6 text-yellow-400" />
            Overall Performance
          </h2>
        </div>
        
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-white/5">
              <tr>
                <th className="text-left p-4 text-gray-300 font-semibold">Rank</th>
                <th className="text-left p-4 text-gray-300 font-semibold">Player</th>
                <th className="text-left p-4 text-gray-300 font-semibold">Win Rate</th>
                <th className="text-left p-4 text-gray-300 font-semibold">KDA</th>
                <th className="text-left p-4 text-gray-300 font-semibold">Games</th>
                <th className="text-left p-4 text-gray-300 font-semibold">Avg Damage</th>
                <th className="text-left p-4 text-gray-300 font-semibold">Vision Score</th>
                <th className="text-left p-4 text-gray-300 font-semibold">Champions</th>
              </tr>
            </thead>
            <tbody>
              {sortedData.map((player, index) => (
                <tr key={player.summonerName} className="border-b border-white/10 hover:bg-white/5 transition-colors">
                  <td className="p-4">
                    <div className="flex items-center gap-2">
                      {index === 0 && <Crown className="w-5 h-5 text-yellow-400" />}
                      {index === 1 && <Shield className="w-5 h-5 text-gray-400" />}
                      {index === 2 && <Swords className="w-5 h-5 text-orange-400" />}
                      <span className="text-white font-bold">#{index + 1}</span>
                    </div>
                  </td>
                  <td className="p-4">
                    <div>
                      <div className="text-white font-semibold">{player.summonerName}</div>
                      <div className="text-gray-400 text-sm">#{player.tagLine}</div>
                    </div>
                  </td>
                  <td className="p-4">
                    <span className={`font-bold ${
                      parseFloat(player.winRate) >= 60 ? 'text-green-400' :
                      parseFloat(player.winRate) >= 50 ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      {player.winRate}%
                    </span>
                  </td>
                  <td className="p-4">
                    <span className={`font-bold ${
                      parseFloat(player.kda) >= 2.0 ? 'text-green-400' :
                      parseFloat(player.kda) >= 1.5 ? 'text-yellow-400' : 'text-red-400'
                    }`}>
                      {player.kda}
                    </span>
                  </td>
                  <td className="p-4 text-gray-300">{player.totalGames}</td>
                  <td className="p-4 text-gray-300">{player.avgDamagePerGame.toLocaleString()}</td>
                  <td className="p-4 text-gray-300">{player.avgVisionScore}</td>
                  <td className="p-4 text-gray-300">{player.championPoolSize}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Position Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 overflow-hidden">
          <div className="p-4 bg-white/5 border-b border-white/20">
            <h3 className="text-lg font-bold text-white">Best KDA by Player</h3>
          </div>
          <div className="p-4">
            {[...data].sort((a, b) => parseFloat(b.kda) - parseFloat(a.kda)).slice(0, 5).map((player, index) => (
              <div key={player.summonerName} className="flex justify-between items-center py-2 border-b border-white/10 last:border-b-0">
                <div className="flex items-center gap-3">
                  <span className="text-gray-400 font-bold">#{index + 1}</span>
                  <span className="text-white">{player.summonerName}</span>
                </div>
                <span className="text-green-400 font-bold">{player.kda}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 overflow-hidden">
          <div className="p-4 bg-white/5 border-b border-white/20">
            <h3 className="text-lg font-bold text-white">Highest Damage Dealers</h3>
          </div>
          <div className="p-4">
            {[...data].sort((a, b) => parseInt(b.avgDamagePerGame) - parseInt(a.avgDamagePerGame)).slice(0, 5).map((player, index) => (
              <div key={player.summonerName} className="flex justify-between items-center py-2 border-b border-white/10 last:border-b-0">
                <div className="flex items-center gap-3">
                  <span className="text-gray-400 font-bold">#{index + 1}</span>
                  <span className="text-white">{player.summonerName}</span>
                </div>
                <span className="text-red-400 font-bold">{player.avgDamagePerGame.toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Meme Stats Component
function MemeLeaderboard({ data }) {
  const { leaderboards } = data;

  const MemeCard = ({ title, players, icon: Icon, description, getValue, colorClass = "text-purple-400" }) => (
    <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 overflow-hidden">
      <div className="p-4 bg-white/5 border-b border-white/20">
        <div className="flex items-center gap-2 mb-2">
          <Icon className={`w-6 h-6 ${colorClass}`} />
          <h3 className="text-lg font-bold text-white">{title}</h3>
        </div>
        <p className="text-sm text-gray-400">{description}</p>
      </div>
      <div className="p-4">
        {players?.slice(0, 3).map((player, index) => (
          <div key={player.summonerName} className="flex justify-between items-center py-2 border-b border-white/10 last:border-b-0">
            <div className="flex items-center gap-3">
              <span className="text-gray-400 font-bold">#{index + 1}</span>
              <div>
                <div className="text-white font-semibold">{player.summonerName}</div>
                <div className="text-gray-400 text-sm">#{player.tagLine}</div>
              </div>
            </div>
            <span className={`font-bold ${colorClass}`}>
              {getValue(player)}
            </span>
          </div>
        ))}
        {(!players || players.length === 0) && (
          <div className="text-center text-gray-400 py-4">
            No data available yet
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Meme Stats Overview */}
      <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 p-6 text-center">
        <h2 className="text-2xl font-bold text-white mb-2">🎭 The Hall of Memes 🎭</h2>
        <p className="text-gray-300">Where legends are born and egos are destroyed</p>
      </div>

      {/* Meme Cards Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <MemeCard
          title="First Blood Victims 💀"
          players={leaderboards.mostLikelyToDieFirst}
          icon={Skull}
          description="Most likely to give away first blood"
          getValue={(p) => `${p.firstBloodVictimRate}%`}
          colorClass="text-red-400"
        />
        
        <MemeCard
          title="Flash Into Wall Kings ⚡"
          players={leaderboards.flashIntoWallKing}
          icon={Zap}
          description="Masters of the misplaced flash"
          getValue={(p) => `${p.flashIntoWallRate}% fails`}
          colorClass="text-yellow-400"
        />
        
        <MemeCard
          title="Solo Death Specialists 🎯"
          players={leaderboards.soloDeathSpecialist}
          icon={Target}
          description="Going in alone and staying there"
          getValue={(p) => `${p.soloDeathRate}%`}
          colorClass="text-orange-400"
        />
        
        <MemeCard
          title="Carriage Potential 👑"
          players={leaderboards.bestCarriagePotential}
          icon={Crown}
          description="High kills but still loses somehow"
          getValue={(p) => `${p.carriageRate}%`}
          colorClass="text-purple-400"
        />
        
        <MemeCard
          title="Most Carried 🛡️"
          players={leaderboards.mostCarried}
          icon={Shield}
          description="Wins with minimal contribution"
          getValue={(p) => `${p.carriedRate}%`}
          colorClass="text-blue-400"
        />
        
        <MemeCard
          title="One-Trick Ponies 🐴"
          players={leaderboards.biggestOneChampPony}
          icon={Users}
          description="Champion pool depth = 1"
          getValue={(p) => `${p.oneChampPonyRate}% ${p.oneChampPonyName || ''}`}
          colorClass="text-green-400"
        />
      </div>

      {/* Fun Facts Section */}
      <div className="bg-white/10 backdrop-blur-sm rounded-lg border border-white/20 p-6">
        <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <Zap className="w-6 h-6 text-yellow-400" />
          Fun Facts About Your Friend Group
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white/5 rounded-lg p-4">
            <h4 className="text-white font-semibold mb-2">💀 Death Statistics</h4>
            <p className="text-gray-300 text-sm">
              The average first blood victim rate is{' '}
              {leaderboards.mostLikelyToDieFirst?.length > 0 
                ? `${(leaderboards.mostLikelyToDieFirst.reduce((sum, p) => sum + parseFloat(p.firstBloodVictimRate), 0) / leaderboards.mostLikelyToDieFirst.length).toFixed(1)}%`
                : 'calculating...'
              }
            </p>
          </div>
          <div className="bg-white/5 rounded-lg p-4">
            <h4 className="text-white font-semibold mb-2">🎯 Champion Diversity</h4>
            <p className="text-gray-300 text-sm">
              Most versatile player has{' '}
              {leaderboards.mostVersatile?.[0]?.championPoolSize || 'calculating'} different champions
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;