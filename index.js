const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const express = require('express');
const http = require('http');
const path = require('path');

// ====================== PROXY CONFIGURATION =======================
const PROXY_CONFIG = {
  enabled: process.env.PROXY_ENABLED === 'true',
  host: process.env.PROXY_HOST,
  port: parseInt(process.env.PROXY_PORT || '0'),
  username: process.env.PROXY_USERNAME,
  password: process.env.PROXY_PASSWORD
};

// ======================= USER CONFIGURATION =======================
const CONFIG = {
  MY_ID: process.env.MY_ID,
  PHOENIX: process.env.PHOENIX,
  URL_REF: process.env.URL_REF,
  URL_NAL: process.env.URL_NAL,
  URL_SPRAY: process.env.URL_SPRAY,
  URL_A4IV: process.env.URL_A4IV,
  URL_PACKNUM: process.env.URL_PACKNUM,
  URL_SPRAYER: process.env.URL_SPRAYER,
  URL_PACK0PEN: process.env.URL_PACK0PEN,
  URL_PACK4EK: process.env.URL_PACK4EK,
  URL_CARD_TEMPLATE: process.env.URL_CARD_TEMPLATE,
  URL_COLLECTIONS: process.env.URL_COLLECTIONS,
  URL_BREW: process.env.URL_BREW,
};

// ======================= BREWING CONFIGURATION =======================
const BREWING_CONFIG = {
  3235: {
    collectionIds: [17920, 17921, 17922],
    cardsPerBrew: 16
  },
  3236: {
    collectionIds: [17923, 17924, 17925],
    cardsPerBrew: 8
  },
  3237: {
    collectionIds: [17953, 17986, 17987],
    cardsPerBrew: 4
  }
};

// ======================= USER DATA STORAGE =======================
let userData = {
  jwtToken: null,
  lastRefresh: null,
  nextSprayTime: null,
  sprayCount: 0,
  achievementsClaimed: 0,
  lastFunds: 0,
  logs: [],
  isActive: false,
  dailyFundsChecks: 0,
  dailyAchievementsDone: false,
  
  // Scheduling parameters (weekday)
  dayStart: '07:11',    // CET = UTC+1
  dayEnd: '23:59',      // CET = UTC+1
  jitter: 12,           // minutes
  baseInterval: 30,     // minutes
  randomScale1: 0,      // minutes
  randomScale2: 8,      // minutes
  
  // Weekend parameters
  weekendDayStart: '08:44',    // CET = UTC+1 (07:44 UTC)
  weekendDayEnd: '23:47',      // CET = UTC+1 (22:47 UTC)
  weekendJitter: 42,           // minutes
  weekendBaseInterval: 30,     // minutes
  weekendRandomScale1: 5,      // minutes
  weekendRandomScale2: 33,     // minutes
  
  // Internal state
  _effectiveStartUTC: null,
  _effectiveEndUTC: null,
  _startJitterMin: 0,
  _achTimers: [],
  _dailyRolloverTimer: null
};

// Debug logs storage
let debugLogs = [];

// Brewing sessions for stop functionality
let brewingSessions = {};

// Prize mapping
const PRIZE_MAP = {
  11986: '5,000 Silvercoins',
  11981: 'Core 2026 Standard Pack',
  12013: 'EPL 23 Pack',
  11980: '500 Silvercoins',
  11985: '1,000,000 Silvercoins',
  11984: '100,000 Silvercoins',
  11983: '2,500 Silvercoins',
  11982: '1,000 Silvercoins'
};

// ======================= UTILITY FUNCTIONS =======================

// Debug logging function
function debugLog(action, url, method, headers = {}, data = null, response = null, error = null) {
  const debugEntry = {
    timestamp: new Date().toISOString(),
    action,
    request: {
      url,
      method,
      headers: JSON.stringify(headers, null, 2),
      body: data ? JSON.stringify(data, null, 2) : null
    },
    response: response ? {
      status: response.status,
      data: JSON.stringify(response.data, null, 2)
    } : null,
    error: error ? {
      message: error.message,
      status: error.response?.status,
      data: error.response?.data ? JSON.stringify(error.response.data, null, 2) : null
    } : null
  };

  debugLogs.unshift(debugEntry);
  if (debugLogs.length > 200) debugLogs.pop();

  console.log('\n' + '='.repeat(80));
  console.log(` DEBUG [${debugEntry.timestamp}]`);
  console.log(` ACTION: ${action}`);
  console.log(` REQUEST: ${method} ${url}`);
  console.log(`   URL: ${url}`);
  console.log(`   METHOD: ${method}`);
  console.log(`   HEADERS:`, JSON.stringify(headers, null, 2));
  
  if (data) console.log(`   BODY:`, JSON.stringify(data, null, 2));
  
  if (error) {
    console.log(`❌ ERROR: ${error.message}`);
  } else if (response) {
    console.log(`✅ RESPONSE: ${response.status}`);
    console.log(`   STATUS: ${response.status}`);
    console.log(`   DATA:`, JSON.stringify(response.data, null, 2));
  }
  console.log('='.repeat(80) + '\n');
}

// Activity logging
function logActivity(message) {
  const timestamp = new Date().toISOString();
  const logEntry = { timestamp, message };

  userData.logs.unshift(logEntry);
  userData.logs = userData.logs.slice(0, 1000);
  
  console.log(`[${timestamp}] ${message}`);
}

// Get proxy configuration for axios
function getAxiosConfig() {
  const config = {
    timeout: 30000,
    httpsAgent: new (require('https').Agent)({
      rejectUnauthorized: false,
      keepAlive: true
    })
  };
  
  if (PROXY_CONFIG.enabled && PROXY_CONFIG.host) {
    const proxyUrl = `http://${PROXY_CONFIG.username}:${PROXY_CONFIG.password}@${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`;
    config.httpsAgent = new HttpsProxyAgent(proxyUrl);
    config.httpAgent = new HttpsProxyAgent(proxyUrl);
    config.proxy = false;
    
    console.log(`🔌 Proxy enabled via agent: ${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`);
  }
  
  return config;
}

// ======================= API REQUEST FUNCTION WITH PROXY =======================
async function makeAPIRequest(url, method = 'GET', headers = {}, data = null) {
  try {
    debugLog('SENDING_REQUEST', url, method, headers, data);
    
    const axiosConfig = {
      method: method.toLowerCase(),
      url: url,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      data: data,
      ...getAxiosConfig()
    };

    const response = await axios(axiosConfig);

    debugLog('REQUEST_SUCCESS', url, method, headers, data, response);
    return { success: true, data: response.data, status: response.status };
    
  } catch (error) {
    debugLog('REQUEST_ERROR', url, method, headers, data, null, error);
    return {
      success: false,
      error: error.message,
      status: error.response?.status,
      responseData: error.response?.data
    };
  }
}

// ======================= SCHEDULING FUNCTIONS =======================

// Check if it's weekend (Saturday or Sunday)
function isWeekend(date = new Date()) {
  const day = date.getUTCDay(); // 0 = Sunday, 6 = Saturday
  return day === 0 || day === 6;
}

// Get scheduling parameters for specific date
function getSchedulingParams(date = new Date()) {
  if (isWeekend(date)) {
    return {
      dayStart: userData.weekendDayStart,
      dayEnd: userData.weekendDayEnd,
      jitter: userData.weekendJitter,
      baseInterval: userData.weekendBaseInterval,
      randomScale1: userData.weekendRandomScale1,
      randomScale2: userData.weekendRandomScale2
    };
  } else {
    return {
      dayStart: userData.dayStart,
      dayEnd: userData.dayEnd,
      jitter: userData.jitter,
      baseInterval: userData.baseInterval,
      randomScale1: userData.randomScale1,
      randomScale2: userData.randomScale2
    };
  }
}

// Convert CET to UTC (CET = UTC+1)
function cetToUTC(cetTime) {
  const [hours, minutes] = cetTime.split(':').map(Number);
  let utcHours = hours - 1; // CET to UTC
  if (utcHours < 0) utcHours += 24;
  return { hours: utcHours, minutes };
}

// Create date at specific UTC time
function utcDateAt(hour, minute, second = 0, ms = 0, date = new Date()) {
  const d = new Date(date);
  d.setUTCHours(hour, minute, second, ms);
  return d;
}

// Add minutes to date
function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * 60000);
}

// Add milliseconds to date
function addMs(date, ms) {
  return new Date(date.getTime() + ms);
}

// Check if within active window
function isWithinActiveWindow() {
  if (!userData._effectiveStartUTC || !userData._effectiveEndUTC) {
    computeEffectiveWindow();
  }

  const now = new Date();
  return now >= userData._effectiveStartUTC && now <= userData._effectiveEndUTC;
}

// Compute effective window for today
function computeEffectiveWindow(date = new Date()) {
  const params = getSchedulingParams(date);
  const cetStart = cetToUTC(params.dayStart);
  const cetEnd = cetToUTC(params.dayEnd);
  
  let effectiveStart = utcDateAt(cetStart.hours, cetStart.minutes, 0, 0, date);
  let effectiveEnd = utcDateAt(cetEnd.hours, cetEnd.minutes, 0, 0, date);
  
  // Handle midnight crossing
  if (effectiveEnd <= effectiveStart) {
    effectiveEnd = addMinutes(effectiveEnd, 24 * 60);
  }
  
  // Add jitter (±jitter minutes)
  const jitterMs = (params.jitter * 60000);
  const randomJitter = Math.floor(Math.random() * (2 * jitterMs + 1)) - jitterMs;
  effectiveStart = addMs(effectiveStart, randomJitter);
  
  userData._effectiveStartUTC = effectiveStart;
  userData._effectiveEndUTC = effectiveEnd;
  userData._startJitterMin = Math.round(randomJitter / 60000);
  
  logActivity(`📅 Effective window: ${effectiveStart.toUTCString()} to ${effectiveEnd.toUTCString()} (jitter: ${userData._startJitterMin}m)`);
  
  return { effectiveStart, effectiveEnd };
}

// Calculate next spray time
function calculateNextSprayTime() {
  const params = getSchedulingParams();
  
  // Convert to milliseconds
  const baseIntervalMs = params.baseInterval * 60000;
  const randomScale1Ms = params.randomScale1 * 60000;
  const randomScale2Ms = params.randomScale2 * 60000;
  
  const randomAddMs = Math.floor(
    Math.random() * (randomScale2Ms - randomScale1Ms) + randomScale1Ms
  );

  const totalDelayMs = baseIntervalMs + randomAddMs;
  const nextSprayTime = new Date(Date.now() + totalDelayMs);
  userData.nextSprayTime = nextSprayTime.toISOString();

  logActivity(`⏰ Next spray in ${Math.round(totalDelayMs / 60000)} minutes (at ${nextSprayTime.toUTCString()})`);
  
  return nextSprayTime;
}

// ======================= CORE API FUNCTIONS =======================

// Token refresh
async function refreshToken() {
  if (!CONFIG.PHOENIX) {
    logActivity('ERROR: No refresh token configured');
    return false;
  }

  const headers = { 'Content-Type': 'application/json' };
  const requestData = { refreshToken: CONFIG.PHOENIX };

  logActivity('Starting token refresh...');
  const result = await makeAPIRequest(CONFIG.URL_REF, 'POST', headers, requestData);

  if (result.success && result.data.data?.jwt) {
    userData.jwtToken = result.data.data.jwt;
    userData.lastRefresh = new Date().toISOString();
    userData.isActive = true;

    if (result.data.data?.refreshToken && result.data.data.refreshToken !== 'Not provided') {
      logActivity('New refresh token received');
    }

    logActivity('✅ Token refresh successful');
    
    // Schedule next token refresh
    scheduleNextTokenRefresh();
    
    return true;
  } else {
    logActivity(`❌ Token refresh failed: ${result.error}`);
    userData.isActive = false;
    return false;
  }
}

// Schedule next token refresh
function scheduleNextTokenRefresh() {
  // Always refresh at 06:07 UTC (07:07 CET)
  const now = new Date();
  let nextRefresh = utcDateAt(6, 7, 0, 0);
  
  // If already past today's refresh time, schedule for tomorrow
  if (now >= nextRefresh) {
    nextRefresh = addMinutes(nextRefresh, 24 * 60);
  }
  
  // Add jitter (±jitter minutes)
  const jitterMs = (userData.jitter * 60000);
  const randomJitter = Math.floor(Math.random() * (2 * jitterMs + 1)) - jitterMs;
  nextRefresh = addMs(nextRefresh, randomJitter);
  
  const delay = Math.max(nextRefresh.getTime() - Date.now(), 1000);
  
  setTimeout(async () => {
    logActivity(`🔄 Scheduled token refresh (jitter: ${Math.round(randomJitter/60000)}m)`);
    await refreshToken();
  }, delay);
  
  logActivity(`⏰ Next token refresh scheduled for: ${nextRefresh.toUTCString()}`);
}

// Check funds
async function checkFunds() {
  if (!userData.jwtToken) {
    logActivity('ERROR: No JWT token available for funds check');
    return null;
  }

  const headers = { 'x-user-jwt': userData.jwtToken };
  const result = await makeAPIRequest(CONFIG.URL_NAL, 'GET', headers);
  
  if (result.success && result.data.data) {
    const silvercoins = result.data.data.silvercoins || 0;
    userData.lastFunds = silvercoins;
    userData.dailyFundsChecks++;
    logActivity(`💰 Funds: ${silvercoins.toLocaleString()} silvercoins`);
    return silvercoins;
  } else {
    if (result.status === 401) {
      logActivity('JWT expired during funds check, attempting refresh...');
      const refreshSuccess = await refreshToken();
      if (refreshSuccess) {
        return await checkFunds();
      }
    }
    logActivity(`❌ Funds check failed: ${result.error}`);
    return null;
  }
}

// Claim achievements
async function claimAchievements() {
  if (!userData.jwtToken) {
    logActivity('ERROR: No JWT token available for achievements');
    return 0;
  }

  const headers = { 'x-user-jwt': userData.jwtToken };
  const userAchievementsUrl = `${CONFIG.URL_A4IV}/${CONFIG.MY_ID}/user`;
  
  logActivity('🎯 Starting achievements claim process...');

  try {
    // Get available achievements
    const achievementsResult = await makeAPIRequest(userAchievementsUrl, 'GET', headers);
    
    if (!achievementsResult.success) {
      if (achievementsResult.status === 401) {
        logActivity('JWT expired during achievements check, attempting refresh...');
        const refreshSuccess = await refreshToken();
        if (refreshSuccess) {
          return await claimAchievements();
        }
      }
      logActivity(`❌ Achievements check failed: ${achievementsResult.error}`);
      return 0;
    }

    const validIDs = [];
    const categories = ['achievements', 'daily', 'weekly', 'monthly'];

    // Collect claimable achievement IDs
    categories.forEach((category) => {
      if (achievementsResult.data.data[category]) {
        achievementsResult.data.data[category].forEach((item) => {
          if (item.progress?.claimAvailable) {
            validIDs.push(item.id);
          }
        });
      }
    });

    if (validIDs.length === 0) {
      logActivity('ℹ️ No achievements available to claim');
      return 0;
    }

    // Claim achievements
    let totalClaimed = 0;
    for (const achievementId of validIDs) {
      const claimUrl = `${CONFIG.URL_A4IV}/${achievementId}/claim/`;
      const claimResult = await makeAPIRequest(claimUrl, 'POST', headers);
      
      if (claimResult.success) {
        totalClaimed++;
      }
      
      await new Promise(resolve => setTimeout(resolve, 800));
    }

    userData.achievementsClaimed += totalClaimed;
    logActivity(`🎉 Successfully claimed ${totalClaimed} achievements`);
    return totalClaimed;

  } catch (error) {
    logActivity(`❌ Error in achievements process: ${error.message}`);
    return 0;
  }
}

// Execute scheduled spray (free spray - no purchase)
async function executeScheduledSpray(sprayerId) {
  if (!userData.jwtToken) {
    logActivity('ERROR: No JWT token available for scheduled spray');
    calculateNextSprayTime();
    return null;
  }

  if (!isWithinActiveWindow()) {
    logActivity('⏰ Outside active window, skipping scheduled spray');
    return null;
  }

  logActivity(`🎰 Executing scheduled free spray with sprayerId: ${sprayerId}...`);

  try {
    const headers = {
      'x-user-jwt': userData.jwtToken,
      'Content-Type': 'application/json'
    };

    const sprayResult = await makeAPIRequest(CONFIG.URL_SPRAY, 'POST', headers, { spinnerId: parseInt(sprayerId) });

    if (!sprayResult.success) {
      if (sprayResult.status === 401) {
        logActivity('JWT expired during spray, attempting refresh...');
        await refreshToken();
      }
      logActivity(`⚠️ Scheduled spray failed: ${sprayResult.error}`);
    } else {
      const sprayData = sprayResult.data.data;
      const resultId = sprayData.id;
      const prizeName = PRIZE_MAP[resultId] || `ID = ${resultId}`;
      userData.sprayCount++;
      logActivity(`🎉 Scheduled spray successful! Received: ${prizeName}`);
      
      // Additional API calls
      await makeAPIRequest(CONFIG.URL_PACKNUM, 'GET', headers);
      const sprayerUserUrl = `${CONFIG.URL_SPRAYER}/user`;
      await makeAPIRequest(sprayerUserUrl, 'GET', headers);
      const sprayerHistoryUrl = `${CONFIG.URL_SPRAYER}/history?categoryId=1`;
      await makeAPIRequest(sprayerHistoryUrl, 'GET', headers);
      
      return prizeName;
    }
  } catch (error) {
    logActivity(`❌ Scheduled spray error: ${error.message}`);
  } finally {
    calculateNextSprayTime();
  }

  return null;
}

// MANUAL SPRAY FUNCTION - with buy spray logic
async function executeManualSpray(sprayerId) {
  if (!userData.jwtToken) {
    logActivity('ERROR: No JWT token available for manual spray');
    return { success: false, error: 'No JWT token available' };
  }

  logActivity(`🎰 Starting manual spray process with sprayerId: ${sprayerId}...`);

  try {
    const headers = {
      'x-user-jwt': userData.jwtToken,
      'Content-Type': 'application/json'
    };

    // 1. First, check sprayer user data
    const sprayerUserUrl = `${CONFIG.URL_SPRAYER}/user`;
    const sprayerUserResult = await makeAPIRequest(sprayerUserUrl, 'GET', headers);

    if (!sprayerUserResult.success) {
      if (sprayerUserResult.status === 401) {
        logActivity('JWT expired during sprayer check, attempting refresh...');
        const refreshSuccess = await refreshToken();
        if (refreshSuccess) {
          return await executeManualSpray(sprayerId);
        }
      }
      return { success: false, error: `Sprayer check failed: ${sprayerUserResult.error}` };
    }

    // 2. Check if we need to buy a spray
    const totalLeft = sprayerUserResult.data.data?.totalLeft || 0;
    
    if (totalLeft === 0) {
      logActivity('🛒 No free sprays left, buying a spray...');
      
      // Buy a spray
      const buySprayUrl = `${CONFIG.URL_SPRAYER}/buy-spin?categoryId=1`;
      const buySprayResult = await makeAPIRequest(buySprayUrl, 'POST', headers, {
        categoryId: 1,
        amount: 1
      });

      if (!buySprayResult.success) {
        return { success: false, error: `Buy spray failed: ${buySprayResult.error}` };
      }
      
      logActivity('✅ Spray purchased successfully');
    } else if (totalLeft === 1) {
      logActivity('🎉 Free spray available, skipping purchase');
    }

    // 3. Now execute the spray
    const sprayUrl = `${CONFIG.URL_SPRAYER}/spin?categoryId=1`;
    const sprayResult = await makeAPIRequest(sprayUrl, 'POST', headers, {
      spinnerId: parseInt(sprayerId)
    });

    if (!sprayResult.success) {
      return { success: false, error: `Spray failed: ${sprayResult.error}` };
    }

    // 4. Process the result
    const sprayData = sprayResult.data.data;
    const resultId = sprayData.id;
    const prizeName = PRIZE_MAP[resultId] || `ID = ${resultId}`;
    userData.sprayCount++;
    
    logActivity(`🎉 Manual spray successful! Received: ${prizeName}`);
    return { success: true, prize: prizeName, prizeId: resultId };
    
  } catch (error) {
    logActivity(`❌ Manual spray error: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// Execute multiple sprays
async function executeMultipleSprays(count, sprayerId) {
  const results = [];
  let successful = 0;
  let failed = 0;
  
  // First, check initial funds
  const initialFunds = await checkFunds();
  
  for (let i = 0; i < count; i++) {
    try {
      logActivity(`🔄 Manual spray ${i + 1}/${count} starting...`);
      const result = await executeManualSpray(sprayerId);
      results.push({
        spray: i + 1,
        success: result.success,
        prize: result.prize,
        prizeId: result.prizeId,
        timestamp: new Date().toISOString()
      });
      
      if (result.success) {
        successful++;
      } else {
        failed++;
      }
      
      // Add delay between sprays
      if (i < count - 1) {
        await new Promise(resolve => setTimeout(resolve, 2700));
      }
      
    } catch (error) {
      results.push({
        spray: i + 1,
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      });
      failed++;
    }
  }
  
  // Check final funds
  const finalFunds = await checkFunds();
  
  // Calculate statistics
  const fundsSpent = (initialFunds || 0) - (finalFunds || 0);
  const silverPerSpray = successful > 0 ? fundsSpent / successful : 0;
  const totalSilverValue = count * 1000;
  const returnPercentage = totalSilverValue > 0 ? ((totalSilverValue - fundsSpent) / totalSilverValue) * 100 : 0;
  
  return {
    success: true,
    summary: {
      totalRequested: count,
      successful,
      failed,
      initialFunds: initialFunds || 0,
      finalFunds: finalFunds || 0,
      fundsSpent,
      silverPerSpray,
      returnPercentage: returnPercentage.toFixed(2)
    },
    results
  };
}

// Get user packs with pagination
async function getUserPacks() {
  if (!userData.jwtToken) {
    return { success: false, error: 'No JWT token available' };
  }
  
  const headers = { 'x-user-jwt': userData.jwtToken };
  
  try {
    let allPacks = [];
    let page = 1;
    let hasMore = true;
    
    while (hasMore) {
      const url = `${CONFIG.URL_PACK4EK}?page=${page}&categoryIds=1%2C73`;
      const result = await makeAPIRequest(url, 'GET', headers);
      
      if (!result.success) {
        if (page === 1) {
          return result;
        } else {
          break;
        }
      }
      
      if (result.data.data?.packs) {
        allPacks = allPacks.concat(result.data.data.packs);
        
        if (result.data.data.packs.length === 0 || 
            (result.data.data.count * page) >= result.data.data.total) {
          hasMore = false;
        } else {
          page++;
        }
      } else {
        hasMore = false;
      }
    }
    
    return { success: true, data: { packs: allPacks } };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Open a pack
async function openPack(packId) {
  if (!userData.jwtToken) {
    return { success: false, error: 'No JWT token available' };
  }
  
  const headers = {
    'x-user-jwt': userData.jwtToken,
    'Content-Type': 'application/json'
  };
  
  const url = CONFIG.URL_PACK0PEN;
  const data = { categoryId: 1, packId };
  
  return await makeAPIRequest(url, 'POST', headers, data);
}

// Get card template details
async function getCardTemplates(templateIds) {
  if (!userData.jwtToken || templateIds.length === 0) {
    return { success: false, error: 'No token or empty template IDs' };
  }
  
  const headers = { 'x-user-jwt': userData.jwtToken };
  const idsParam = templateIds.join('%2C');
  const url = `${CONFIG.URL_CARD_TEMPLATE}?ids=${idsParam}`;
  
  return await makeAPIRequest(url, 'GET', headers);
}

// ======================= ENHANCED BREWING FUNCTIONS =======================

// Check user funds for brewing
async function checkUserFunds() {
  if (!userData.jwtToken) {
    return { success: false, error: 'No JWT token available' };
  }

  const headers = { 'x-user-jwt': userData.jwtToken };
  const result = await makeAPIRequest(CONFIG.URL_NAL, 'GET', headers);
  
  if (result.success && result.data.data) {
    return { success: true, balance: result.data.data.silvercoins || 0 };
  } else {
    return { success: false, error: result.error };
  }
}

// Get collection cards with full details
async function getCollectionCardsWithDetails(collectionId, minMintNumber) {
  if (!userData.jwtToken || !CONFIG.MY_ID) {
    return { success: false, error: 'No JWT token or user ID available' };
  }

  const headers = { 'x-user-jwt': userData.jwtToken };
  const url = `${CONFIG.URL_COLLECTIONS}/${collectionId}/users/${CONFIG.MY_ID}/owned2`;
  
  const result = await makeAPIRequest(url, 'GET', headers);
  
  if (!result.success) {
    return { success: false, error: result.error };
  }

  let cards = [];
  if (result.data?.data?.cards) {
    cards = result.data.data.cards;
  } else if (Array.isArray(result.data?.data)) {
    cards = result.data.data;
  } else if (Array.isArray(result.data)) {
    cards = result.data;
  }

  // Filter cards by mint number and status
  const filteredCards = cards
    .filter(card => {
      if (minMintNumber && card.mintNumber) {
        return parseInt(card.mintNumber) >= minMintNumber;
      }
      return true;
    })
    .filter(card => card.status === 'available')
    .map(card => ({
      id: card.id,
      mintBatch: card.mintBatch || '',
      mintNumber: card.mintNumber || 0,
      status: card.status,
      rating: card.rating || 'N/A',
      collectionId: collectionId,
      isMarketList: card.isMarketList || false,
      ethStatus: card.ethStatus || 'none',
      bundleId: card.bundleId || null
    }));

  return { success: true, cards: filteredCards };
}

// Get available cards for all requirements
async function getAvailableCards(minMintNumber, stopRequestRef) {
  const cardsByRequirement = {};
  const cardsWithDetails = {};
  const collectionStats = {};

  for (const [requirementId, config] of Object.entries(BREWING_CONFIG)) {
    if (stopRequestRef.stopped) break;

    const cards = [];
    const reqCollections = [];

    for (const collectionId of config.collectionIds) {
      if (stopRequestRef.stopped) break;

      const collectionResult = await getCollectionCardsWithDetails(collectionId, minMintNumber);
      
      if (collectionResult.success) {
        const availableCount = collectionResult.cards.length;
        reqCollections.push(availableCount);
        
        collectionResult.cards.forEach(card => {
          cardsWithDetails[card.id] = card;
        });
        
        cards.push(...collectionResult.cards.map(card => card.id));
      } else {
        reqCollections.push(0);
      }

      await new Promise(resolve => setTimeout(resolve, 800));
    }

    cardsByRequirement[requirementId] = cards;
    collectionStats[requirementId] = reqCollections;
  }

  return { cardsByRequirement, cardsWithDetails, collectionStats };
}

// Sort cards by mint number (highest first)
function sortCardsByMintDesc(cardsByRequirement, cardsWithDetails) {
  const sorted = {};
  
  for (const [requirementId, cardIds] of Object.entries(cardsByRequirement)) {
    const cardsWithMints = cardIds
      .map(id => ({ id, details: cardsWithDetails[id] }))
      .filter(item => item.details && item.details.mintNumber)
      .sort((a, b) => b.details.mintNumber - a.details.mintNumber);
    
    sorted[requirementId] = cardsWithMints.map(item => item.id);
  }
  
  return sorted;
}

// Calculate brewable batches
function calculateBrewableBatches(cardsByRequirement, maxBrews) {
  let maxPossibleBrews = maxBrews;
  
  for (const [requirementId, cards] of Object.entries(cardsByRequirement)) {
    const cardsNeededPerBrew = BREWING_CONFIG[requirementId].cardsPerBrew;
    const possibleBrewsForRequirement = Math.floor(cards.length / cardsNeededPerBrew);
    
    if (possibleBrewsForRequirement < maxPossibleBrews) {
      maxPossibleBrews = possibleBrewsForRequirement;
    }
  }
  
  return maxPossibleBrews;
}

// Find lowest mint to be used
function findLowestMintToBeUsed(cardsByRequirement, cardsWithDetails, batches) {
  const usedMints = [];
  
  for (const [requirementId, cardIds] of Object.entries(cardsByRequirement)) {
    const cardsNeeded = BREWING_CONFIG[requirementId].cardsPerBrew * batches;
    
    const cardsWithMints = cardIds
      .map(id => cardsWithDetails[id])
      .filter(card => card && card.mintNumber)
      .sort((a, b) => b.mintNumber - a.mintNumber);
    
    const usedForRequirement = cardsWithMints.slice(-cardsNeeded);
    usedMints.push(...usedForRequirement.map(card => card.mintNumber));
  }
  
  if (usedMints.length === 0) return 'N/A';
  
  const lowestMint = Math.min(...usedMints);
  return lowestMint;
}

// Open a slot
async function openSlot(slotId) {
  if (!userData.jwtToken) {
    return { success: false, error: 'No JWT token available' };
  }
  
  const headers = {
    'x-user-jwt': userData.jwtToken,
    'Content-Type': 'application/json'
  };
  
  const url = `${CONFIG.URL_BREW}/slots/${slotId}/open-instant`;
  return await makeAPIRequest(url, 'POST', headers);
}

// Process a single brew
async function processBrew(brewingPlanId, silvercoins, sortedCardsByRequirement, cardsWithDetails, usedCardIds, brewNum, stopRequestRef) {
  if (!userData.jwtToken) {
    return { success: false, error: 'No JWT token available' };
  }

  const headers = {
    'x-user-jwt': userData.jwtToken,
    'Content-Type': 'application/json'
  };

  // Prepare requirements
  const requirements = [];
  const cardsUsedInThisBrew = [];
  const cardsUsedDetails = [];

  for (const [requirementId, config] of Object.entries(BREWING_CONFIG)) {
    if (stopRequestRef.stopped) break;

    const cardsNeeded = config.cardsPerBrew;
    
    const availableCards = (sortedCardsByRequirement[requirementId] || [])
      .filter(cardId => !usedCardIds.has(cardId));
    
    if (availableCards.length < cardsNeeded) {
      throw new Error(`Not enough cards for requirement ${requirementId}`);
    }
    
    const selectedCardIds = availableCards.slice(0, cardsNeeded);
    
    selectedCardIds.forEach(cardId => {
      usedCardIds.add(cardId);
      const cardDetails = cardsWithDetails[cardId];
      cardsUsedInThisBrew.push(cardId);
      cardsUsedDetails.push({
        id: cardId,
        requirementId,
        mintBatch: cardDetails?.mintBatch || '',
        mintNumber: cardDetails?.mintNumber || 'N/A'
      });
    });
    
    requirements.push({
      requirementId: parseInt(requirementId),
      entityIds: selectedCardIds
    });
  }

  if (stopRequestRef.stopped) {
    return { success: false, stopped: true };
  }

  // Execute brew
  const brewUrl = `${CONFIG.URL_BREW}/plans/${brewingPlanId}`;
  const brewData = { requirements, silvercoins };

  const brewResult = await makeAPIRequest(brewUrl, 'POST', headers, brewData);

  if (!brewResult.success) {
    // Remove used cards if brew failed
    cardsUsedInThisBrew.forEach(id => usedCardIds.delete(id));
    return { success: false, error: brewResult.error };
  }

  // Open slots
  const slots = brewResult.data.data?.slots || [];
  const cardsReceived = [];

  if (slots.length > 0) {
    for (let slotIndex = 0; slotIndex < slots.length; slotIndex++) {
      if (stopRequestRef.stopped) break;

      const slotId = slots[slotIndex].id;
      const slotResult = await openSlot(slotId);

      if (slotResult.success && slotResult.data.data?.cards?.length > 0) {
        const card = slotResult.data.data.cards[0];
        cardsReceived.push({
          mintBatch: card.mintBatch || '',
          mintNumber: card.mintNumber || 'N/A',
          rating: card.rating || 'N/A'
        });
      }

      if (slotIndex < slots.length - 1 && !stopRequestRef.stopped) {
        await new Promise(resolve => setTimeout(resolve, 1500));
      }
    }
  }

  return { 
    success: true, 
    cardsReceived,
    cardsUsed: cardsUsedDetails.map(c => `${c.mintBatch}${c.mintNumber}`).join(', ')
  };
}

// Enhanced execute brewing with scan-then-proceed pattern
async function executeBrewing(brewingPlanId, silvercoins, minMintNumber, maxBrews, operationDelay, stopRequestRef, sessionId, stopAfterScan = false) {
  if (!userData.jwtToken) {
    return { success: false, error: 'No JWT token available' };
  }

  const results = {
    logs: [],
    totalBrews: 0,
    successfulBrews: 0,
    cardsReceived: [],
    scanResults: null,
    scanComplete: false,
    proceedAfterScan: false
  };

  function addLog(message, type = 'info') {
    const logEntry = {
      timestamp: new Date().toISOString(),
      message,
      type
    };
    results.logs.push(logEntry);
    console.log(`[BREW] ${message}`);
  }

  // Store session for proceed control
  brewingSessions[sessionId] = {
    stopRequestRef,
    results,
    proceed: false
  };

  // SCAN PHASE
  addLog('💰 Checking balance...', 'compact');
  
  const fundsResult = await checkUserFunds();
  if (!fundsResult.success) {
    addLog(`❌ Funds check failed: ${fundsResult.error}`, 'error');
    return { success: false, error: fundsResult.error, logs: results.logs };
  }
  
  const initialSilver = fundsResult.balance;
  addLog(`💰 Balance: ${initialSilver.toLocaleString()}`, 'compact');

  // Scan collections
  addLog('🔍 Scanning collections...', 'compact');
  
  const { cardsByRequirement, cardsWithDetails, collectionStats } = await getAvailableCards(minMintNumber, stopRequestRef);

  if (stopRequestRef.stopped) {
    return { success: false, stopped: true, logs: results.logs };
  }

  // Display collection stats in one line per requirement
  for (const [reqId, stats] of Object.entries(collectionStats)) {
    addLog(`📦 Req ${reqId}: total ${cardsByRequirement[reqId].length} (${stats.join('/')} available)`, 'compact');
  }

  // Calculate possible brews
  const cardBasedBatches = calculateBrewableBatches(cardsByRequirement, maxBrews);
  const fundBasedBatches = Math.floor(initialSilver / silvercoins);
  const actualBrews = Math.min(cardBasedBatches, fundBasedBatches, maxBrews);
  const lowestMintUsed = findLowestMintToBeUsed(cardsByRequirement, cardsWithDetails, actualBrews);

  // Store scan results
  results.scanResults = {
    cardBasedBatches,
    fundBasedBatches,
    actualBrews,
    lowestMintUsed,
    initialSilver,
    silverPerBrew: silvercoins
  };
  
  addLog(`📊 Cards:${cardBasedBatches} brews | Funds:${fundBasedBatches} brews | Lowest mint:${lowestMintUsed}`, 'compact');

  if (actualBrews === 0) {
    addLog('❌ No brews possible', 'error');
    results.scanComplete = true;
    return { success: false, logs: results.logs, scanComplete: true, scanResults: results.scanResults };
  }

  results.scanComplete = true;
  
  // If stopAfterScan is true, return now with the logs
  if (stopAfterScan) {
    addLog('⏸️ Scan complete - waiting for approval...', 'highlight');
    return { 
      success: true, 
      logs: results.logs, 
      scanComplete: true, 
      scanResults: results.scanResults,
      sessionId 
    };
  }

  // Wait for user to proceed (original behavior)
  addLog('⏸️ Scan complete - waiting for approval...', 'highlight');

  // Wait for proceed signal
  while (!brewingSessions[sessionId].proceed && !stopRequestRef.stopped) {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  if (stopRequestRef.stopped) {
    return { success: false, stopped: true, logs: results.logs };
  }

  // BREWING PHASE
  addLog('▶️ Starting brewing...', 'compact');

  // Sort cards by mint number (highest first)
  const sortedCardsByRequirement = sortCardsByMintDesc(cardsByRequirement, cardsWithDetails);
  const usedCardIds = new Set();
  const allCardsReceived = [];

  for (let brewNum = 1; brewNum <= actualBrews; brewNum++) {
    if (stopRequestRef.stopped) break;

    try {
      // Check funds before each brew
      const currentFundsResult = await checkUserFunds();
      if (!currentFundsResult.success || currentFundsResult.balance < silvercoins) {
        addLog(`⚠️ Insufficient funds for brew ${brewNum}`, 'warning');
        break;
      }

      const brewResult = await processBrew(
        brewingPlanId,
        silvercoins,
        sortedCardsByRequirement,
        cardsWithDetails,
        usedCardIds,
        brewNum,
        stopRequestRef
      );

      if (brewResult.success) {
        results.successfulBrews++;
        
        if (brewResult.cardsReceived && brewResult.cardsReceived.length > 0) {
          allCardsReceived.push(...brewResult.cardsReceived);
          
          // Format cards for display
          const cardsDisplay = brewResult.cardsReceived.map(c => 
            `${c.mintBatch}${c.mintNumber}(${c.rating})`
          ).join(', ');
          
          addLog(`🍺 Brew ${brewNum}/${actualBrews} | Slots ${brewResult.cardsReceived.length} | Got: ${cardsDisplay}`, 'compact');
        } else {
          addLog(`🍺 Brew ${brewNum}/${actualBrews} completed`, 'compact');
        }
      } else {
        addLog(`❌ Brew ${brewNum} failed`, 'error');
      }

      results.totalBrews++;

      if (brewNum < actualBrews && !stopRequestRef.stopped) {
        await new Promise(resolve => setTimeout(resolve, operationDelay));
      }

    } catch (error) {
      addLog(`❌ Error in brew ${brewNum}: ${error.message}`, 'error');
    }
  }

  // Final summary
  results.cardsReceived = allCardsReceived;
  
  if (allCardsReceived.length > 0) {
    const uniqueCards = new Map();
    allCardsReceived.forEach(card => {
      const key = `${card.mintBatch}-${card.mintNumber}`;
      if (!uniqueCards.has(key)) {
        uniqueCards.set(key, card);
      }
    });
    
    const sortedCards = Array.from(uniqueCards.values()).sort((a, b) => {
      const numA = parseInt(a.mintNumber) || 0;
      const numB = parseInt(b.mintNumber) || 0;
      return numA - numB;
    });
    
    const cardsList = sortedCards.map(c => `${c.mintBatch}${c.mintNumber}(${c.rating})`).join(', ');
    addLog(`✅ Complete | Brewed: ${cardsList}`, 'success');
  } else {
    addLog(`✅ Complete | ${results.successfulBrews}/${actualBrews} brews successful`, 'success');
  }

  // Clean up session
  delete brewingSessions[sessionId];

  return { success: true, ...results };
}

// Proceed after scan
async function proceedBrewing(sessionId) {
  if (brewingSessions[sessionId]) {
    brewingSessions[sessionId].proceed = true;
    return { success: true };
  }
  return { success: false, error: 'Session not found' };
}

// ======================= SCHEDULING & INITIALIZATION =======================

// Schedule daily plan
function scheduleDailyPlan() {
  // Clear existing timers
  if (userData._achTimers) {
    userData._achTimers.forEach(timer => clearTimeout(timer));
  }
  if (userData._dailyRolloverTimer) {
    clearTimeout(userData._dailyRolloverTimer);
  }
  
  userData._achTimers = [];
  
  // Compute today's window
  const now = new Date();
  const { effectiveStart, effectiveEnd } = computeEffectiveWindow(now);
  
  // Store the effective window (used by isWithinActiveWindow)
  userData._effectiveStartUTC = effectiveStart;
  userData._effectiveEndUTC = effectiveEnd;
  
  logActivity(`📅 Daily plan: ${effectiveStart.toUTCString()} to ${effectiveEnd.toUTCString()}`);
  
  // Schedule achievements
  
  const claim1 = addMinutes(effectiveStart, 25);
const claim2 = addMinutes(claim1, 70);
const claim3 = addMinutes(effectiveStart, 190);
const claim4 = addMinutes(effectiveStart, 280);
const claim5 = addMinutes(effectiveStart, 410);
const claim6 = addMinutes(effectiveStart, 570);
const claim7 = addMinutes(effectiveEnd, -70);
const claim8 = addMinutes(effectiveEnd, -15);
  
  const scheduleClaim = (when, label) => {
    const delay = when.getTime() - Date.now();
    if (delay <= 0) {
      logActivity(`⏭️ ${label} skipped (time passed)`);
      return;
    }
    
    const timer = setTimeout(async () => {
      try {
        if (userData.isActive) {
          logActivity(`🏁 ${label} firing`);
          await claimAchievements();
        }
      } catch (error) {
        logActivity(`⚠️ ${label} error: ${error.message}`);
      }
    }, delay);
    
    userData._achTimers.push(timer);
    logActivity(`⏰ ${label} scheduled for ${when.toUTCString()}`);
  };
  
scheduleClaim(claim1, 'Achievements #1');
scheduleClaim(claim2, 'Achievements #2)');
scheduleClaim(claim3, 'Achievements #3');
scheduleClaim(claim4, 'Achievements #4');
scheduleClaim(claim5, 'Achievements #5');
scheduleClaim(claim6, 'Achievements #6');
scheduleClaim(claim7, 'Achievements #7');
scheduleClaim(claim8, 'Achievements #8');
  
  // Schedule rollover for TOMORROW
  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  
  const tomorrowStart = utcDateAt(
    effectiveStart.getUTCHours(),
    effectiveStart.getUTCMinutes(),
    0, 0,
    tomorrow
  );
  
  const rolloverTime = addMinutes(tomorrowStart, 2);
  const rolloverDelay = Math.max(rolloverTime.getTime() - Date.now(), 1000);
  
  userData._dailyRolloverTimer = setTimeout(() => {
    logActivity('🔁 Daily rollover - scheduling next day');
    scheduleDailyPlan();
  }, rolloverDelay);
  
  logActivity(`⏰ Daily rollover scheduled for ${rolloverTime.toUTCString()}`);
}

// Continuous operations
function startContinuousOperations(sprayerId) {
  console.log('🚀 Starting continuous operations...');
  
  // Spray operations - check every 30 seconds
  setInterval(async () => {
    if (userData.isActive && isWithinActiveWindow()) {
      if (!userData.nextSprayTime || new Date() >= new Date(userData.nextSprayTime)) {
        await executeScheduledSpray(sprayerId);
      }
    }
  }, 30000);
  
  // Funds check during active windows - every 5 hours
  setInterval(async () => {
    if (isWithinActiveWindow() && userData.isActive) {
      await checkFunds();
    }
  }, 5 * 60 * 60 * 1000);
}

// Initialize the spray service
async function initialize() {
  try {
    console.log('🚀 INITIALIZING SPRAYER SERVICE...');
    
    // Refresh token
    await refreshToken();
    
    // Wait a bit then start operations
    setTimeout(() => {
      logActivity('🚀 Starting operations after token refresh');
      
      // Schedule daily plan
      scheduleDailyPlan();
      
      // Check funds
      checkFunds();
      
      // Start continuous operations - default sprayerId 6865 will be overridden by frontend
      startContinuousOperations(6865);
    }, 60000);
    
    console.log('✅ Sprayer service initialized successfully');
    
  } catch (error) {
    console.error('❌ Failed to initialize sprayer service:', error);
  }
}

// ======================= DATA ACCESS FUNCTIONS =======================

function getUserData() {
  // Create safe copy without timer objects
  const safeData = { ...userData };
  delete safeData._achTimers;
  delete safeData._dailyRolloverTimer;
  
  // Convert dates to ISO strings
  if (safeData._effectiveStartUTC instanceof Date) {
    safeData._effectiveStartUTC = safeData._effectiveStartUTC.toISOString();
  }
  if (safeData._effectiveEndUTC instanceof Date) {
    safeData._effectiveEndUTC = safeData._effectiveEndUTC.toISOString();
  }
  
  return safeData;
}

function getActivityLogs(limit = 100) {
  return userData.logs.slice(0, limit);
}

function getDebugLogs(limit = 50) {
  return debugLogs.slice(0, limit);
}

// ======================= EXPRESS SERVER =======================
const app = express();
const server = http.createServer(app);

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ======================= API ROUTES =======================

// Get user data for dashboard
app.get('/api/user', (req, res) => {
  const safeData = getUserData();
  res.json(safeData);
});

// Get activity logs
app.get('/api/activity', (req, res) => {
  const limit = parseInt(req.query.limit) || 100;
  res.json(getActivityLogs(limit));
});

// Get debug logs
app.get('/api/debug-logs', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  res.json(getDebugLogs(limit));
});

// Manual triggers
app.post('/api/refresh', async (req, res) => {
  const success = await refreshToken();
  res.json({ success, message: success ? 'Token refreshed' : 'Refresh failed' });
});

app.post('/api/scheduled-spray', async (req, res) => {
  const { sprayerId = 6865 } = req.body;
  const result = await executeScheduledSpray(sprayerId);
  res.json({ success: !!result, result });
});

app.post('/api/claim-achievements', async (req, res) => {
  const claimed = await claimAchievements();
  res.json({ success: claimed > 0, claimed });
});

app.post('/api/check-funds', async (req, res) => {
  const funds = await checkFunds();
  res.json({ success: funds !== null, funds });
});

// Manual spray endpoint with buy spray logic
app.post('/api/proxy/manual-spray', async (req, res) => {
  try {
    const { sprayerId = 6865 } = req.body;
    const result = await executeManualSpray(sprayerId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Multiple manual sprays
app.post('/api/proxy/multiple-sprays', async (req, res) => {
  try {
    const { count = 1, sprayerId = 6865 } = req.body;
    const results = await executeMultipleSprays(count, sprayerId);
    res.json(results);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Proxy for pack operations
app.get('/api/proxy/packs', async (req, res) => {
  try {
    const result = await getUserPacks();
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/proxy/open-pack', async (req, res) => {
  try {
    const { packId } = req.body;
    const result = await openPack(packId);
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/proxy/card-templates', async (req, res) => {
  try {
    const { templateIds } = req.body;
    const result = await getCardTemplates(templateIds);
    if (result.success) {
      res.json(result);
    } else {
      res.status(500).json({ error: result.error });
    }
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ======================= ENHANCED BREWING API ROUTES =======================

// Start brewing with scan phase
app.post('/api/brewing/start', async (req, res) => {
  try {
    const { 
      brewingPlanId = '3202',
      silvercoins = 5000,
      minMintNumber = 30,
      maxBrews = 10,
      operationDelay = 3400
    } = req.body;

    const sessionId = Date.now().toString();
    const stopRequestRef = { stopped: false };

    // Execute brewing in background BUT WAIT FOR SCAN PHASE TO COMPLETE
    // We need to modify executeBrewing to return scan results without waiting for proceed
    const result = await executeBrewing(
      brewingPlanId,
      silvercoins,
      minMintNumber,
      maxBrews,
      operationDelay,
      stopRequestRef,
      sessionId,
      true // New parameter to indicate we want to stop after scan
    );

    res.json({
      success: true,
      sessionId,
      scanComplete: result.scanComplete || false,
      scanResults: result.scanResults || null,
      logs: result.logs || [] // Make sure logs are included
    });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});



// Proceed after scan
app.post('/api/brewing/proceed/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const result = await proceedBrewing(sessionId);
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Stop brewing
app.post('/api/brewing/stop', (req, res) => {
  try {
    // Set stop flag for all active sessions
    Object.values(brewingSessions).forEach(session => {
      if (session.stopRequestRef) {
        session.stopRequestRef.stopped = true;
      }
    });
    res.json({ success: true, message: 'Stop requested' });
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// Get brewing session status
app.get('/api/brewing/status/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const session = brewingSessions[sessionId];
  
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  
  res.json({
    scanComplete: session.results.scanComplete,
    scanResults: session.results.scanResults,
    logs: session.results.logs.slice(-20),
    stopped: session.stopRequestRef.stopped
  });
});

// ======================= START SERVER =======================
const PORT = process.env.PORT || 8080;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Sprayer server running on port ${PORT}`);
  console.log(`📊 Dashboard available at http://localhost:${PORT} (or your Render URL)`);
  
  // Initialize sprayer service (delayed to ensure token refresh first)
  setTimeout(() => {
    initialize();
  }, 5000);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  server.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  server.close();
  process.exit(0);
});