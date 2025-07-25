// Global variables
const API_BASE = 'https://lolvsfriends-backend.onrender.com';
let leaderboardData = [];
let memeData = { playerStats: [], leaderboards: {} };
let currentSort = 'winRate';

// DOM Elements
const loadingEl = document.getElementById('loading');
const errorStateEl = document.getElementById('errorState');
const mainContentEl = document.getElementById('mainContent');
const refreshBtn = document.getElementById('refreshBtn');
const refreshText = document.getElementById('refreshText');
const lastUpdatedEl = document.getElementById('lastUpdated');

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    setupEventListeners();
    fetchData();
});

// Set up event listeners
function setupEventListeners() {
    // Tab navigation
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            switchTab(e.target.dataset.tab);
        });
    });

    // Sort buttons
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            sortLeaderboard(e.target.dataset.sort);
        });
    });

    // Refresh button
    refreshBtn.addEventListener('click', refreshData);

    // Player comparison selector
    const playerSelect = document.getElementById('playerSelect');
    if (playerSelect) {
        playerSelect.addEventListener('change', (e) => {
            if (e.target.value) {
                showComparison(e.target.value);
            } else {
                hideComparison();
            }
        });
    }
}

// Fetch data from backend
async function fetchData() {
    showLoading();
    try {
        const [leaderboardRes, memeRes] = await Promise.all([
            fetch(`${API_BASE}/api/leaderboard`),
            fetch(`${API_BASE}/api/meme-leaderboard`)
        ]);

        if (!leaderboardRes.ok || !memeRes.ok) {
            throw new Error('Failed to fetch data');
        }

        leaderboardData = await leaderboardRes.json();
        memeData = await memeRes.json();

        showMainContent();
        updateLastUpdated();
        populateAllTabs();
    } catch (error) {
        console.error('Error fetching data:', error);
        showError(error.message);
    }
}

// Refresh data
async function refreshData() {
    setRefreshLoading(true);
    try {
        // First refresh backend data
        await fetch(`${API_BASE}/api/refresh-friends`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });
        
        // Then fetch updated data
        await fetchData();
    } catch (error) {
        console.error('Error refreshing data:', error);
        showError('Failed to refresh data. Please try again.');
    } finally {
        setRefreshLoading(false);
    }
}

// UI State Management
function showLoading() {
    loadingEl.style.display = 'flex';
    errorStateEl.style.display = 'none';
    mainContentEl.style.display = 'none';
}

function showError(message) {
    document.getElementById('errorMessage').textContent = message;
    loadingEl.style.display = 'none';
    errorStateEl.style.display = 'flex';
    mainContentEl.style.display = 'none';
}

function showMainContent() {
    loadingEl.style.display = 'none';
    errorStateEl.style.display = 'none';
    mainContentEl.style.display = 'block';
}

function setRefreshLoading(loading) {
    refreshBtn.disabled = loading;
    refreshText.textContent = loading ? 'Updating...' : 'Refresh';
}

function updateLastUpdated() {
    const now = new Date();
    lastUpdatedEl.textContent = `Updated: ${now.toLocaleTimeString()}`;
}

// Tab switching
function switchTab(tabName) {
    // Update nav buttons
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });
    document.getElementById(tabName).classList.add('active');
}

// Populate all tabs with data
function populateAllTabs() {
    populateOverviewStats();
    populateRichestSection(); // New feature
    populateLeaderboard();
    populatePlayerSelector();
    populateHallOfFame();
}

// Populate overview stats
function populateOverviewStats() {
    const totalPlayers = leaderboardData.length;
    const totalGames = leaderboardData.reduce((sum, player) => sum + parseInt(player.totalGames), 0);
    const bestPlayer = [...leaderboardData].sort((a, b) => parseFloat(b.winRate) - parseFloat(a.winRate))[0];
    const bestKDAPlayer = [...leaderboardData].sort((a, b) => parseFloat(b.kda) - parseFloat(a.kda))[0];

    document.getElementById('totalPlayers').textContent = totalPlayers;
    document.getElementById('totalGames').textContent = totalGames.toLocaleString();
    document.getElementById('bestWinRate').textContent = `${bestPlayer?.winRate}%`;
    document.getElementById('bestPlayer').textContent = bestPlayer?.summonerName;
    document.getElementById('bestKDA').textContent = bestKDAPlayer?.kda;
    document.getElementById('bestKDAPlayer').textContent = bestKDAPlayer?.summonerName;
}

// NEW: Populate Who's the Richest section
function populateRichestSection() {
    const richestPodium = document.getElementById('richestPodium');
    if (!richestPodium) return; // Skip if element doesn't exist
    
    try {
        const richestData = leaderboardData
            .map(player => ({
                summonerName: player.summonerName,
                totalGames: parseInt(player.totalGames) || 0,
                avgGold: parseInt(player.avgGoldPerGame) || 0,
                totalGold: (parseInt(player.avgGoldPerGame) || 0) * (parseInt(player.totalGames) || 0)
            }))
            .sort((a, b) => b.totalGold - a.totalGold)
            .slice(0, 3);

        const positions = ['1st', '2nd', '3rd'];
        const emojis = ['🥇', '🥈', '🥉'];
        
        richestPodium.innerHTML = richestData.map((player, index) => `
            <div class="podium-position podium-${positions[index]}">
                <div class="rank">${emojis[index]}</div>
                <div class="player-name">${player.summonerName}</div>
                <div class="gold-amount">${player.totalGold.toLocaleString()}g</div>
                <div class="game-count">${player.totalGames} games</div>
            </div>
        `).join('');
    } catch (error) {
        console.error('Error in richest section:', error);
        richestPodium.innerHTML = '<div style="color: #b0b0b0;">Unable to load richest players</div>';
    }
}

// Populate leaderboard table
function populateLeaderboard() {
    const sortedData = sortData(leaderboardData, currentSort);
    const tbody = document.getElementById('leaderboardBody');
    
    tbody.innerHTML = sortedData.map((player, index) => `
        <tr>
            <td>
                <div class="rank-cell">
                    ${index === 0 ? '<span class="rank-icon">👑</span>' : ''}
                    <span class="player-rank">#${index + 1}</span>
                </div>
            </td>
            <td>
                <div class="player-info">
                    <div class="player-name">${player.summonerName}</div>
                    <div class="player-tag">#${player.tagLine}</div>
                </div>
            </td>
            <td><span class="${getWinRateClass(player.winRate)}">${player.winRate}%</span></td>
            <td><span class="${getKDAClass(player.kda)}">${player.kda}</span></td>
            <td>${player.totalGames}</td>
            <td>${parseInt(player.avgDamagePerGame).toLocaleString()}</td>
            <td>${player.avgVisionScore}</td>
            <td>${player.championPoolSize}</td>
        </tr>
    `).join('');
}

// Sort leaderboard data
function sortData(data, sortBy) {
    return [...data].sort((a, b) => {
        switch(sortBy) {
            case 'winRate':
                return parseFloat(b.winRate) - parseFloat(a.winRate);
            case 'kda':
                return parseFloat(b.kda) - parseFloat(a.kda);
            case 'damage':
                return parseInt(b.avgDamagePerGame) - parseInt(a.avgDamagePerGame);
            default:
                return parseFloat(b.winRate) - parseFloat(a.winRate);
        }
    });
}

// Sort leaderboard and update display
function sortLeaderboard(sortBy) {
    currentSort = sortBy;
    
    // Update sort button states
    document.querySelectorAll('.sort-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.querySelector(`[data-sort="${sortBy}"]`).classList.add('active');
    
    // Re-populate table
    populateLeaderboard();
}

// Get CSS class for win rate coloring
function getWinRateClass(winRate) {
    const rate = parseFloat(winRate);
    if (rate >= 60) return 'stat-positive';
    if (rate >= 50) return 'stat-neutral';
    return 'stat-negative';
}

// Get CSS class for KDA coloring
function getKDAClass(kda) {
    const ratio = parseFloat(kda);
    if (ratio >= 2.0) return 'stat-positive';
    if (ratio >= 1.5) return 'stat-neutral';
    return 'stat-negative';
}

// Populate player selector for comparison
function populatePlayerSelector() {
    const selector = document.getElementById('playerSelect');
    if (!selector) return;
    
    const sortedPlayers = [...leaderboardData].sort((a, b) => a.summonerName.localeCompare(b.summonerName));
    
    selector.innerHTML = '<option value="">Select your player...</option>' +
        sortedPlayers.map(player => 
            `<option value="${player.summonerName}">${player.summonerName}#${player.tagLine}</option>`
        ).join('');
}

// Show comparison for selected player
function showComparison(playerName) {
    const selectedPlayer = leaderboardData.find(p => p.summonerName === playerName);
    if (!selectedPlayer) return;

    const otherPlayers = leaderboardData.filter(p => p.summonerName !== playerName);
    
    // Show player's summary stats
    document.getElementById('playerSummary').innerHTML = `
        <div class="summary-stat">
            <h4>Win Rate</h4>
            <div class="value ${getWinRateClass(selectedPlayer.winRate)}">${selectedPlayer.winRate}%</div>
        </div>
        <div class="summary-stat">
            <h4>KDA Ratio</h4>
            <div class="value ${getKDAClass(selectedPlayer.kda)}">${selectedPlayer.kda}</div>
        </div>
        <div class="summary-stat">
            <h4>Total Games</h4>
            <div class="value">${selectedPlayer.totalGames}</div>
        </div>
        <div class="summary-stat">
            <h4>Avg Damage</h4>
            <div class="value">${parseInt(selectedPlayer.avgDamagePerGame).toLocaleString()}</div>
        </div>
        <div class="summary-stat">
            <h4>Vision Score</h4>
            <div class="value">${selectedPlayer.avgVisionScore}</div>
        </div>
        <div class="summary-stat">
            <h4>Champion Pool</h4>
            <div class="value">${selectedPlayer.championPoolSize}</div>
        </div>
    `;

    // Show comparison table
    const comparisonBody = document.getElementById('comparisonBody');
    comparisonBody.innerHTML = otherPlayers.map(friend => `
        <tr>
            <td>
                <div class="player-info">
                    <div class="player-name">${friend.summonerName}</div>
                    <div class="player-tag">#${friend.tagLine}</div>
                </div>
            </td>
            <td>
                <span class="${getComparisonClass(selectedPlayer.winRate, friend.winRate, true)}">
                    ${friend.winRate}%
                </span>
            </td>
            <td>
                <span class="${getComparisonClass(selectedPlayer.kda, friend.kda, true)}">
                    ${friend.kda}
                </span>
            </td>
            <td>
                <span class="${getComparisonClass(selectedPlayer.avgDamagePerGame, friend.avgDamagePerGame, true)}">
                    ${parseInt(friend.avgDamagePerGame).toLocaleString()}
                </span>
            </td>
            <td>
                <span class="${getComparisonClass(selectedPlayer.avgVisionScore, friend.avgVisionScore, true)}">
                    ${friend.avgVisionScore}
                </span>
            </td>
            <td>
                <span class="${getComparisonClass(selectedPlayer.championPoolSize, friend.championPoolSize, true)}">
                    ${friend.championPoolSize}
                </span>
            </td>
        </tr>
    `).join('');

    document.getElementById('comparisonResults').classList.remove('hidden');
}

// Hide comparison results
function hideComparison() {
    const results = document.getElementById('comparisonResults');
    if (results) results.classList.add('hidden');
}

// Get comparison class (better/worse/equal)
function getComparisonClass(playerValue, friendValue, higherIsBetter = true) {
    const pVal = parseFloat(playerValue);
    const fVal = parseFloat(friendValue);
    
    if (pVal === fVal) return 'equal';
    
    if (higherIsBetter) {
        return pVal > fVal ? 'worse' : 'better';
    } else {
        return pVal > fVal ? 'better' : 'worse';
    }
}

// Populate Hall of Fame (meme stats) - simplified version
function populateHallOfFame() {
    const { leaderboards } = memeData;
    const memeGrid = document.getElementById('memeGrid');
    
    const memeCards = [
        {
            title: 'First Blood Any%',
            icon: '💀',
            description: 'lane over',
            data: leaderboards.mostLikelyToDieFirst,
            getValue: (p) => `${p.firstBloodVictimRate}%`,
            color: 'red'
        },
        {
            title: 'Flash Kings',
            icon: '📸',
            description: 'yes league tracks how often you flash into a wall',
            data: leaderboards.flashIntoWallKing,
            getValue: (p) => `${p.flashIntoWallRate}%`,
            color: 'yellow'
        },
        {
            title: 'Solo Deaths',
            icon: '🌚',
            description: 'bro just group...',
            data: leaderboards.soloDeathSpecialist,
            getValue: (p) => `${p.soloDeathRate}%`,
            color: 'orange'
        },
        {
            title: 'My jg bro',
            icon: '🌈',
            description: 'High kills but still loses somehow',
            data: leaderboards.bestCarriagePotential,
            getValue: (p) => `${p.carriageRate}%`,
            color: 'purple'
        },
        {
            title: '"I have yt open in another tab"',
            icon: '🦖',
            description: 'Wins with minimal contribution',
            data: leaderboards.mostCarried,
            getValue: (p) => `${p.carriedRate}%`,
            color: 'blue'
        },
        {
            title: 'One Tricked',
            icon: '🐴',
            description: 'Champion pool depth exists',
            data: leaderboards.biggestOneChampPony,
            getValue: (p) => `${p.oneChampPonyRate}% ${p.oneChampPonyName || ''}`,
            color: 'green'
        }
    ];

    memeGrid.innerHTML = memeCards.map(card => `
        <div class="meme-card">
            <div class="meme-header">
                <div class="meme-title">
                    <span style="font-size: 1.5rem;">${card.icon}</span>
                    <h3>${card.title}</h3>
                </div>
                <p class="meme-description">${card.description}</p>
            </div>
            <div class="meme-content">
                ${createMemeEntries(card.data, card.getValue, card.color)}
            </div>
        </div>
    `).join('');
}

// Create meme entries for a card - simplified
function createMemeEntries(data, getValue, color) {
    if (!data || data.length === 0) {
        return '<div style="text-align: center; color: #b0b0b0; padding: 1rem;">No data available yet</div>';
    }

    return data.slice(0, 3).map((player, index) => `
        <div class="meme-entry">
            <div class="meme-player">
                <span class="meme-rank">#${index + 1}</span>
                <div class="meme-player-info">
                    <div class="name">${player.summonerName}</div>
                    <div class="tag">#${player.tagLine}</div>
                </div>
            </div>
            <span class="meme-value ${color}">${getValue(player)}</span>
        </div>
    `).join('');
}