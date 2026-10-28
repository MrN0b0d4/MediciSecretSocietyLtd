const axios = require('axios');
const { HttpsProxyAgent } = require('https-proxy-agent');
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');

// ====================== PERSISTENT CONFIG =======================
const CONFIG_FILE = path.join(__dirname, 'saved_config.json');
let savedConfig = { sprayerId: 7096 };
try {
  if (fs.existsSync(CONFIG_FILE)) {
    savedConfig = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
    console.log(`✅ Loaded saved config: sprayerId = ${savedConfig.sprayerId}`);
  }
} catch (e) { console.log('No saved config, using defaults'); }

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
  URL_DROP: process.env.URL_DROP,
  URL_MARKET_LIST: process.env.URL_MARKET_LIST,
  URL_MARKET_LISTED: process.env.URL_MARKET_LISTED
};

// ======================= PACK CONFIG =======================
let packConfig = { packIds: [14129], fetchDelay: 3000, refreshIntervalHours: 3 };
const PACK_CONFIG_FILE = path.join(__dirname, 'pack_config.json');
try {
  if (fs.existsSync(PACK_CONFIG_FILE)) {
    packConfig = { ...packConfig, ...JSON.parse(fs.readFileSync(PACK_CONFIG_FILE, 'utf8')) };
    console.log(`✅ Loaded pack config: ${packConfig.packIds.length} pack IDs`);
  }
} catch (e) { console.log('No saved pack config'); }

function savePackConfigToFile() {
  try { fs.writeFileSync(PACK_CONFIG_FILE, JSON.stringify(packConfig, null, 2)); return true; }
  catch (e) { console.error('Failed to save pack config:', e); return false; }
}

// ======================= CRAFTING / BREWING PLANS =======================
// User sees "Brewing" in UI; API paths stay /api/crafting/* for compatibility.
const CRAFTING_PLANS = {
  '3400': {
    name: 'Tarot',
    silvercoins: 5000,
    defaultMaxCrafts: 10,
    defaultDelay: 7100,
    requirements: {
      3433: { collectionIds: [22639], cardsPerCraft: 32 },
      3434: { collectionIds: [22640], cardsPerCraft: 16 },
      3435: { collectionIds: [22672], cardsPerCraft: 4 }
    }
  },
  '3367': {
    name: 'Occult',
    silvercoins: 5000,
    defaultMaxCrafts: 10,
    defaultDelay: 7100,
    requirements: {
      3400: { collectionIds: [22639], cardsPerCraft: 32 },
      3401: { collectionIds: [22640], cardsPerCraft: 16 },
      3402: { collectionIds: [22672], cardsPerCraft: 4 }
    }
  },
  '3433': {
    name: 'T3 Legend',
    silvercoins: 10000,
    defaultMaxCrafts: 3,
    defaultDelay: 7100,
    requirements: {
      3466: { collectionIds: [22673], cardsPerCraft: 3 },
      3467: { collectionIds: [22674], cardsPerCraft: 3 }
    }
  }
};

// ======================= USER DATA =======================
let userData = {
  jwtToken: null, lastRefresh: null, nextSprayTime: null,
  sprayCount: 0, achievementsClaimed: 0, lastFunds: 0, logs: [],
  isActive: false, dailyFundsChecks: 0, dailyAchievementsDone: false,
  dayStart: '06:01', dayEnd: '22:59', jitter: 12,
  baseInterval: 30, randomScale1: 0, randomScale2: 8,
  weekendDayStart: '07:04', weekendDayEnd: '23:47', weekendJitter: 42,
  weekendBaseInterval: 30, weekendRandomScale1: 5, weekendRandomScale2: 23,
  _effectiveStartUTC: null, _effectiveEndUTC: null, _startJitterMin: 0,
  _achTimers: [], _dailyRolloverTimer: null
};

let lastFundsData = null; // full funds 
let debugLogs = [];

const PRIZE_MAP = {
  
};

// ======================= SESSIONS =======================
const sessions = new Map();

function createSession(type, label) {
  const id = `${type}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  const session = {
    id, type, label,
    state: 'running',
    stopRequested: false,
    logs: [],
    progress: { current: 0, total: 0, percentage: 0 },
    summary: {},
    startedAt: new Date().toISOString(),
    completedAt: null,
    addLog(message, level = 'info') {
      this.logs.push({ timestamp: new Date().toISOString(), message, level });
      if (this.logs.length > 1000) this.logs.shift();
    },
    setProgress(current, total) {
      this.progress = { current, total, percentage: total > 0 ? Math.round((current / total) * 100) : 0 };
    }
  };
  sessions.set(id, session);
  return session;
}
function getSession(id) { return sessions.get(id); }
function serializeSession(s) {
  return {
    id: s.id, type: s.type, label: s.label, state: s.state,
    stopRequested: s.stopRequested, logs: s.logs,
    progress: s.progress, summary: s.summary,
    startedAt: s.startedAt, completedAt: s.completedAt
  };
}
setInterval(() => {
  const cutoff = Date.now() - 60 * 60 * 1000;
  for (const [id, s] of sessions) {
    if (new Date(s.startedAt).getTime() < cutoff && s.state !== 'running') sessions.delete(id);
  }
}, 5 * 60 * 1000);

// ======================= UTILITIES =======================
function saveConfigToFile() {
  try { fs.writeFileSync(CONFIG_FILE, JSON.stringify(savedConfig, null, 2)); return true; }
  catch (e) { console.error('Failed to save config:', e); return false; }
}
function getCurrentSprayerId() { return savedConfig.sprayerId; }
function updateSprayerId(newId) {
  savedConfig.sprayerId = parseInt(newId) || 7096;
  saveConfigToFile();
  return savedConfig.sprayerId;
}

function debugLog(action, url, method, headers = {}, data = null, response = null, error = null) {
  const entry = {
    timestamp: new Date().toISOString(), action,
    request: { url, method, headers: JSON.stringify(headers, null, 2),
               body: data ? JSON.stringify(data, null, 2) : null },
    response: response ? { status: response.status, data: JSON.stringify(response.data, null, 2) } : null,
    error: error ? { message: error.message, status: error.response?.status,
                     data: error.response?.data ? JSON.stringify(error.response.data, null, 2) : null } : null
  };
  debugLogs.unshift(entry);
  if (debugLogs.length > 200) debugLogs.pop();
  console.log(`\n${'='.repeat(80)}\n DEBUG [${entry.timestamp}] ${action} ${method} ${url}`);
  if (data) console.log(` BODY:`, JSON.stringify(data, null, 2));
  if (error) console.log(`❌ ERROR: ${error.message}`);
  else if (response) console.log(`✅ ${response.status}:`, JSON.stringify(response.data, null, 2));
  console.log('='.repeat(80) + '\n');
}

function logActivity(message) {
  const timestamp = new Date().toISOString();
  userData.logs.unshift({ timestamp, message });
  userData.logs = userData.logs.slice(0, 1000);
  console.log(`[${timestamp}] ${message}`);
}

function getAxiosConfig() {
  const config = {
    timeout: 30000,
    httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false, keepAlive: true })
  };
  if (PROXY_CONFIG.enabled && PROXY_CONFIG.host) {
    const proxyUrl = `http://${PROXY_CONFIG.username}:${PROXY_CONFIG.password}@${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`;
    config.httpsAgent = new HttpsProxyAgent(proxyUrl);
    config.httpAgent = new HttpsProxyAgent(proxyUrl);
    config.proxy = false;
    console.log(`🔌 Proxy enabled: ${PROXY_CONFIG.host}:${PROXY_CONFIG.port}`);
  }
  return config;
}

async function makeAPIRequest(url, method = 'GET', headers = {}, data = null) {
  try {
    debugLog('SENDING_REQUEST', url, method, headers, data);
    const response = await axios({
      method: method.toLowerCase(), url,
      headers: { 'Content-Type': 'application/json', ...headers },
      data, ...getAxiosConfig()
    });
    debugLog('REQUEST_SUCCESS', url, method, headers, data, response);
    return { success: true, data: response.data, status: response.status };
  } catch (error) {
    debugLog('REQUEST_ERROR', url, method, headers, data, null, error);
    return { success: false, error: error.message, status: error.response?.status, responseData: error.response?.data };
  }
}

// ======================= SCHEDULING HELPERS =======================
function isWeekend(date = new Date()) {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}
function getSchedulingParams(date = new Date()) {
  if (isWeekend(date)) {
    return { dayStart: userData.weekendDayStart, dayEnd: userData.weekendDayEnd,
             jitter: userData.weekendJitter, baseInterval: userData.weekendBaseInterval,
             randomScale1: userData.weekendRandomScale1, randomScale2: userData.weekendRandomScale2 };
  }
  return { dayStart: userData.dayStart, dayEnd: userData.dayEnd,
           jitter: userData.jitter, baseInterval: userData.baseInterval,
           randomScale1: userData.randomScale1, randomScale2: userData.randomScale2 };
}
function cetToUTC(cetTime) {
  const [hours, minutes] = cetTime.split(':').map(Number);
  let utcHours = hours - 1;
  if (utcHours < 0) utcHours += 24;
  return { hours: utcHours, minutes };
}
function utcDateAt(hour, minute, second = 0, ms = 0, date = new Date()) {
  const d = new Date(date); d.setUTCHours(hour, minute, second, ms); return d;
}
function addMinutes(date, minutes) { return new Date(date.getTime() + minutes * 60000); }
function addMs(date, ms) { return new Date(date.getTime() + ms); }

function isWithinActiveWindow() {
  if (!userData._effectiveStartUTC || !userData._effectiveEndUTC) computeEffectiveWindow();
  const now = new Date();
  return now >= userData._effectiveStartUTC && now <= userData._effectiveEndUTC;
}
function computeEffectiveWindow(date = new Date()) {
  const params = getSchedulingParams(date);
  const cetStart = cetToUTC(params.dayStart);
  const cetEnd = cetToUTC(params.dayEnd);
  let effectiveStart = utcDateAt(cetStart.hours, cetStart.minutes, 0, 0, date);
  let effectiveEnd = utcDateAt(cetEnd.hours, cetEnd.minutes, 0, 0, date);
  if (effectiveEnd <= effectiveStart) effectiveEnd = addMinutes(effectiveEnd, 24 * 60);
  const jitterMs = params.jitter * 60000;
  const randomJitter = Math.floor(Math.random() * (2 * jitterMs + 1)) - jitterMs;
  effectiveStart = addMs(effectiveStart, randomJitter);
  userData._effectiveStartUTC = effectiveStart;
  userData._effectiveEndUTC = effectiveEnd;
  userData._startJitterMin = Math.round(randomJitter / 60000);
  logActivity(`📅 Window: ${effectiveStart.toUTCString()} → ${effectiveEnd.toUTCString()} (jitter ${userData._startJitterMin}m)`);
  return { effectiveStart, effectiveEnd };
}
function calculateNextSprayTime() {
  const params = getSchedulingParams();
  const baseIntervalMs = params.baseInterval * 60000;
  const randomScale1Ms = params.randomScale1 * 60000;
  const randomScale2Ms = params.randomScale2 * 60000;
  const randomAddMs = Math.floor(Math.random() * (randomScale2Ms - randomScale1Ms) + randomScale1Ms);
  const totalDelayMs = baseIntervalMs + randomAddMs;
  const nextSprayTime = new Date(Date.now() + totalDelayMs);
  userData.nextSprayTime = nextSprayTime.toISOString();
  logActivity(`⏰ Next spray in ${Math.round(totalDelayMs / 60000)}m`);
  return nextSprayTime;
}

// ======================= CORE API =======================
async function refreshToken() {
  if (!CONFIG.PHOENIX) { logActivity('ERROR: No refresh token'); return false; }
  logActivity('Starting token refresh...');
  const result = await makeAPIRequest(CONFIG.URL_REF, 'POST', { 'Content-Type': 'application/json' }, { refreshToken: CONFIG.PHOENIX });
  if (result.success && result.data.data?.jwt) {
    userData.jwtToken = result.data.data.jwt;
    userData.lastRefresh = new Date().toISOString();
    userData.isActive = true;
    logActivity('✅ Token refresh successful');
    scheduleNextTokenRefresh();
    return true;
  }
  logActivity(`❌ Token refresh failed: ${result.error}`);
  userData.isActive = false;
  return false;
}
function scheduleNextTokenRefresh() {
  const now = new Date();
  let nextRefresh = utcDateAt(6, 7, 0, 0);
  if (now >= nextRefresh) nextRefresh = addMinutes(nextRefresh, 24 * 60);
  const jitterMs = userData.jitter * 60000;
  const randomJitter = Math.floor(Math.random() * (2 * jitterMs + 1)) - jitterMs;
  nextRefresh = addMs(nextRefresh, randomJitter);
  const delay = Math.max(nextRefresh.getTime() - Date.now(), 1000);
  setTimeout(async () => {
    logActivity(`🔄 Scheduled token refresh (jitter ${Math.round(randomJitter/60000)}m)`);
    await refreshToken();
  }, delay);
  logActivity(`⏰ Next token refresh: ${nextRefresh.toUTCString()}`);
}

async function checkFunds() {
  if (!userData.jwtToken) { logActivity('ERROR: No JWT for funds'); return null; }
  const result = await makeAPIRequest(CONFIG.URL_NAL, 'GET', { 'x-user-jwt': userData.jwtToken });
  if (result.success && result.data.data) {
    lastFundsData = result.data.data;
    const sc = result.data.data.silvercoins || 0;
    userData.lastFunds = sc;
    userData.dailyFundsChecks++;
    logActivity(`💰 Funds: ${sc.toLocaleString()}`);
    return sc;
  }
  if (result.status === 401) {
    logActivity('JWT expired, refreshing...');
    if (await refreshToken()) return await checkFunds();
  }
  logActivity(`❌ Funds check failed: ${result.error}`);
  return null;
}

async function claimAchievements() {
  if (!userData.jwtToken) return 0;
  const headers = { 'x-user-jwt': userData.jwtToken };
  const url = `${CONFIG.URL_A4IV}/${CONFIG.MY_ID}/user`;
  const ach = await makeAPIRequest(url, 'GET', headers);
  if (!ach.success) {
    if (ach.status === 401) { if (await refreshToken()) return await claimAchievements(); }
    return 0;
  }
  const validIDs = [];
  ['achievements', 'daily', 'weekly', 'monthly'].forEach(cat => {
    (ach.data.data[cat] || []).forEach(item => {
      if (item.progress?.claimAvailable) validIDs.push(item.id);
    });
  });
  if (validIDs.length === 0) return 0;
  let claimed = 0;
  for (const id of validIDs) {
    const r = await makeAPIRequest(`${CONFIG.URL_A4IV}/${id}/claim/`, 'POST', headers);
    if (r.success) claimed++;
    await new Promise(r => setTimeout(r, 800));
  }
  userData.achievementsClaimed += claimed;
  logActivity(`🎉 Claimed ${claimed} achievements`);
  return claimed;
}

async function executeScheduledSpray(sprayerId) {
  if (!userData.jwtToken) { calculateNextSprayTime(); return null; }
  if (!isWithinActiveWindow()) { logActivity('⏰ Outside window, skip'); return null; }
  logActivity(`🎰 Scheduled spray (sprayerId ${sprayerId})...`);
  try {
    const headers = { 'x-user-jwt': userData.jwtToken, 'Content-Type': 'application/json' };
    const r = await makeAPIRequest(CONFIG.URL_SPRAY, 'POST', headers, { spinnerId: parseInt(sprayerId) });
    if (!r.success) {
      if (r.status === 401) await refreshToken();
      logActivity(`⚠️ Scheduled spray failed: ${r.error}`);
    } else {
      const id = r.data.data.id;
      const prizeName = PRIZE_MAP[id] || `ID=${id}`;
      userData.sprayCount++;
      logActivity(`🎉 Received: ${prizeName}`);
      await makeAPIRequest(CONFIG.URL_PACKNUM, 'GET', headers);
      await makeAPIRequest(`${CONFIG.URL_SPRAYER}/user`, 'GET', headers);
      await makeAPIRequest(`${CONFIG.URL_SPRAYER}/history?categoryId=1`, 'GET', headers);
      return prizeName;
    }
  } catch (e) { logActivity(`❌ Scheduled spray error: ${e.message}`); }
  finally { calculateNextSprayTime(); }
  return null;
}

async function executeManualSpray(sprayerId) {
  if (!userData.jwtToken) return { success: false, error: 'No JWT token' };
  try {
    const headers = { 'x-user-jwt': userData.jwtToken, 'Content-Type': 'application/json' };
    const su = await makeAPIRequest(`${CONFIG.URL_SPRAYER}/user`, 'GET', headers);
    if (!su.success) {
      if (su.status === 401) { if (await refreshToken()) return await executeManualSpray(sprayerId); }
      return { success: false, error: `Sprayer check failed: ${su.error}` };
    }
    const totalLeft = su.data.data?.totalLeft || 0;
    let bought = false;
    if (totalLeft === 0) {
      bought = true;
      const buy = await makeAPIRequest(`${CONFIG.URL_SPRAYER}/buy-spin?categoryId=1`, 'POST', headers, { categoryId: 1, amount: 1 });
      if (!buy.success) return { success: false, error: `Buy spray failed: ${buy.error}` };
    }
    const spray = await makeAPIRequest(`${CONFIG.URL_SPRAYER}/spin?categoryId=1`, 'POST', headers, { spinnerId: parseInt(sprayerId) });
    if (!spray.success) return { success: false, error: `Spray failed: ${spray.error}` };
    const id = spray.data.data.id;
    const prizeName = PRIZE_MAP[id] || `ID=${id}`;
    userData.sprayCount++;
    return { success: true, prize: prizeName, prizeId: id, bought, wasFree: totalLeft > 0 };
  } catch (e) { return { success: false, error: e.message }; }
}

// ======================= SPINNER INFO =======================
async function getSpinnerInfo() {
  if (!userData.jwtToken) return { success: false, error: 'No JWT' };
  return makeAPIRequest(`${CONFIG.URL_SPRAYER}?categoryId=1`, 'GET', { 'x-user-jwt': userData.jwtToken });
}

// ======================= SESSION: MULTI SPRAY =======================
async function executeMultipleSpraysSession(count, sprayerId, session) {
  session.addLog(`🎰 Starting ${count} spray(s), sprayerId=${sprayerId}`, 'info');

  // Fetch spinner structure to know prize pool
  const spinnerInfo = await getSpinnerInfo();
  const prizeMap = {}; // id -> { name, chance, count, silverValue }
  if (spinnerInfo.success && spinnerInfo.data?.data?.items) {
    const items = spinnerInfo.data.data.items;
    items.forEach(item => {
      prizeMap[item.id] = {
        name: item.name || `Prize ${item.id}`,
        chance: item.chance || 0,
        count: 0,
        silverValue: item.properties?.silvercoins || 0
      };
    });
    session.summary.prizePool = items.map(item => ({
      id: item.id,
      name: item.name || `Prize ${item.id}`,
      chance: item.chance || 0,
      silverValue: item.properties?.silvercoins || 0
    }));
    session.addLog(`✅ Loaded ${items.length} prizes in pool`, 'success');
  } else {
    session.addLog(`⚠️ Could not fetch spinner info (${spinnerInfo.error || 'unknown'}). Running without prize pool.`, 'warning');
  }

  const initialFunds = await checkFunds();
  session.summary.initialFunds = initialFunds || 0;
  session.addLog(`💰 Initial funds: ${(initialFunds || 0).toLocaleString()}`, 'info');

  let successful = 0, failed = 0, boughtCount = 0, silverReturned = 0;

  for (let i = 0; i < count; i++) {
    if (session.stopRequested) { session.addLog('⏹️ Stopped by user', 'warning'); session.state = 'stopped'; break; }

    session.addLog(`🔄 Spray ${i + 1}/${count}...`, 'info');
    try {
      const r = await executeManualSpray(sprayerId);
      if (r.success) {
        successful++;
        if (r.bought) boughtCount++;
        if (prizeMap[r.prizeId]) {
          prizeMap[r.prizeId].count++;
          const sv = prizeMap[r.prizeId].silverValue;
          silverReturned += sv;
          const extra = sv > 0 ? ` (+${sv.toLocaleString()} silver)` : '';
          session.addLog(`✅ Spray ${i + 1}: ${r.prize}${extra}${r.wasFree ? ' [free]' : ''}`, 'success');
        } else {
          session.addLog(`✅ Spray ${i + 1}: ${r.prize}`, 'success');
        }
      } else {
        failed++;
        session.addLog(`❌ Spray ${i + 1} failed: ${r.error}`, 'error');
      }
    } catch (e) {
      failed++;
      session.addLog(`❌ Spray ${i + 1} error: ${e.message}`, 'error');
    }

    // Update session summary
    session.summary.successful = successful;
    session.summary.failed = failed;
    session.summary.boughtCount = boughtCount;
    session.summary.silverReturned = silverReturned;
    session.summary.prizeCounts = {};
    Object.entries(prizeMap).forEach(([id, p]) => {
      if (p.count > 0) session.summary.prizeCounts[id] = p.count;
    });
    session.setProgress(i + 1, count);

    if (i < count - 1 && !session.stopRequested) await new Promise(r => setTimeout(r, 2700));
  }

  const finalFunds = await checkFunds();
  session.summary.finalFunds = finalFunds || 0;
  const net = (finalFunds || 0) - (initialFunds || 0);
  session.summary.net = net;
  session.summary.roi = initialFunds > 0 ? ((net / initialFunds) * 100).toFixed(2) : '0.00';
  session.addLog(`💰 Final funds: ${(finalFunds || 0).toLocaleString()}`, 'info');
  session.addLog(`💰 Net: ${net >= 0 ? '+' : ''}${net.toLocaleString()} | ROI: ${session.summary.roi}%`, 'info');
  session.addLog(`=== COMPLETE: ${successful} ok, ${failed} failed, ${boughtCount} paid, ${silverReturned.toLocaleString()} silver won ===`, 'success');
  if (session.state === 'running') session.state = 'completed';
}

// ======================= SESSION: OPEN PACKS =======================
async function executeOpenPacksSession(packIds, session) {
  session.addLog(`📦 Opening ${packIds.length} pack(s)...`, 'info');
  let opened = 0, failed = 0, totalCards = 0, totalStickers = 0;

  for (let i = 0; i < packIds.length; i++) {
    if (session.stopRequested) { session.addLog('⏹️ Stopped by user', 'warning'); session.state = 'stopped'; break; }

    const packId = packIds[i];
    session.addLog(`📦 Pack ${i + 1}/${packIds.length} (ID ${packId})...`, 'info');
    try {
      const r = await openPack(packId);
      if (r.success) {
        opened++;
        const cards = r.data?.data?.cards || [];
        const stickers = r.data?.data?.stickers || [];
        totalCards += cards.length; totalStickers += stickers.length;
        session.addLog(`✅ Pack ${packId}: ${cards.length} cards, ${stickers.length} stickers`, 'success');
        [...cards, ...stickers].forEach(c => {
          const info = `${c.type || ''} ${c.mintBatch || ''}${c.mintNumber || ''}`.trim();
          session.addLog(`  • ${info}`, 'info');
        });
      } else {
        failed++;
        session.addLog(`❌ Pack ${packId}: ${r.error || 'failed'}`, 'error');
      }
    } catch (e) {
      failed++;
      session.addLog(`❌ Pack ${packId} error: ${e.message}`, 'error');
    }
    session.setProgress(i + 1, packIds.length);
    session.summary.opened = opened; session.summary.failed = failed;
    session.summary.totalCards = totalCards; session.summary.totalStickers = totalStickers;

    if (i < packIds.length - 1 && !session.stopRequested) await new Promise(r => setTimeout(r, 2700));
  }
  session.addLog(`=== COMPLETE: ${opened} opened, ${failed} failed, ${totalCards} cards, ${totalStickers} stickers ===`, 'success');
  if (session.state === 'running') session.state = 'completed';
}

// ======================= SESSION: CRAFTING / BREWING =======================
async function executeCraftingSession(planId, params, session) {
  const plan = CRAFTING_PLANS[planId];
  if (!plan) { session.addLog(`❌ Unknown plan: ${planId}`, 'error'); session.state = 'error'; return; }

  const { silvercoins, maxCrafts, minMintNumber, useMintFilter, operationDelay } = params;

  session.addLog(`🚀 Starting ${plan.name} (plan ${planId})`, 'info');
  session.addLog(`   silver=${silvercoins}, maxCrafts=${maxCrafts}, mintFilter=${useMintFilter ? `on (min ${minMintNumber})` : 'off'}`, 'info');

  const fundsResult = await checkUserFunds();
  if (!fundsResult.success) { session.addLog(`❌ Funds check failed: ${fundsResult.error}`, 'error'); session.state = 'error'; return; }
  const initialSilver = fundsResult.balance;
  session.summary.initialSilver = initialSilver;
  session.addLog(`💰 Initial silver: ${initialSilver.toLocaleString()}`, 'success');

  session.addLog(`🔍 Scanning collections...`, 'info');
  const cardsByRequirement = {};
  const cardsWithDetails = {};
  const reqEntries = Object.entries(plan.requirements);

  for (let i = 0; i < reqEntries.length; i++) {
    if (session.stopRequested) break;
    const [reqId, cfg] = reqEntries[i];
    session.addLog(`📦 Requirement ${reqId} (need ${cfg.cardsPerCraft}/brew)...`, 'info');
    const cards = [];
    for (const collectionId of cfg.collectionIds) {
      if (session.stopRequested) break;
      const cr = await getCollectionCards(collectionId, useMintFilter ? minMintNumber : 0);
      if (cr.success) {
        session.addLog(`  • Collection ${collectionId}: ${cr.cards.length} available`, 'info');
        cr.cards.forEach(card => { cardsWithDetails[card.id] = card; });
        cards.push(...cr.cards.map(c => c.id));
      } else {
        session.addLog(`  ⚠️ Collection ${collectionId} failed: ${cr.error}`, 'warning');
      }
      await new Promise(r => setTimeout(r, 800));
    }
    cardsByRequirement[reqId] = cards;
    session.addLog(`  ✅ Requirement ${reqId}: ${cards.length} cards`, 'success');
  }
  if (session.stopRequested) { session.addLog('⏹️ Stopped during scan', 'warning'); session.state = 'stopped'; return; }

  let possibleCrafts = maxCrafts;
  for (const [reqId, cIds] of Object.entries(cardsByRequirement)) {
    const need = plan.requirements[reqId].cardsPerCraft;
    const p = Math.floor(cIds.length / need);
    if (p < possibleCrafts) possibleCrafts = p;
  }
  const fundBasedCrafts = Math.floor(initialSilver / silvercoins);
  const actualCrafts = Math.min(possibleCrafts, fundBasedCrafts, maxCrafts);
  session.addLog(`📊 Card-based: ${possibleCrafts}, Fund-based: ${fundBasedCrafts}, Will do: ${actualCrafts}`, 'info');
  session.summary.actualCrafts = actualCrafts;

  if (actualCrafts === 0) {
    session.addLog('❌ No brews possible', 'error');
    session.state = 'completed';
    return;
  }

  session.setProgress(0, actualCrafts);

  const sortedCards = {};
  for (const [reqId, cIds] of Object.entries(cardsByRequirement)) {
    if (useMintFilter) {
      sortedCards[reqId] = cIds
        .map(id => ({ id, d: cardsWithDetails[id] }))
        .filter(x => x.d)
        .sort((a, b) => (parseInt(b.d.mintNumber) || 0) - (parseInt(a.d.mintNumber) || 0))
        .map(x => x.id);
    } else {
      sortedCards[reqId] = [...cIds];
    }
  }

  const usedCardIds = new Set();
  const cardsReceived = [];
  let successfulCrafts = 0;

  for (let craftNum = 1; craftNum <= actualCrafts; craftNum++) {
    if (session.stopRequested) { session.addLog('⏹️ Stopped by user', 'warning'); session.state = 'stopped'; break; }

    session.addLog(`🍺 Brew ${craftNum}/${actualCrafts}...`, 'info');

    try {
      const fundCheck = await checkUserFunds();
      if (!fundCheck.success || fundCheck.balance < silvercoins) {
        session.addLog(`❌ Insufficient funds for brew ${craftNum}`, 'error');
        break;
      }

      const requirements = [];
      const usedThisCraft = [];
      for (const [reqId, cfg] of Object.entries(plan.requirements)) {
        const available = (sortedCards[reqId] || []).filter(id => !usedCardIds.has(id));
        if (available.length < cfg.cardsPerCraft) {
          throw new Error(`Not enough cards for req ${reqId} (need ${cfg.cardsPerCraft}, have ${available.length})`);
        }
        const selected = available.slice(0, cfg.cardsPerCraft);
        selected.forEach(id => { usedCardIds.add(id); usedThisCraft.push(id); });
        requirements.push({ requirementId: parseInt(reqId), entityIds: selected });
      }

      const headers = { 'x-user-jwt': userData.jwtToken, 'Content-Type': 'application/json' };
      const craftResult = await makeAPIRequest(`${CONFIG.URL_BREW}/plans/${planId}`, 'POST', headers, { requirements, silvercoins });

      if (!craftResult.success) {
        usedThisCraft.forEach(id => usedCardIds.delete(id));
        session.addLog(`❌ Brew ${craftNum} failed: ${craftResult.error}`, 'error');
        continue;
      }
      session.addLog(`✅ Brew ${craftNum} request OK`, 'success');

      const slots = craftResult.data.data?.slots || [];
      if (slots.length > 0) {
        session.addLog(`📦 Opening ${slots.length} slot(s)...`, 'info');
        for (let i = 0; i < slots.length; i++) {
          if (session.stopRequested) break;
          const slotId = slots[i].id;
          const slotResult = await makeAPIRequest(`${CONFIG.URL_BREW}/slots/${slotId}/open-instant`, 'POST', headers);
          if (slotResult.success && slotResult.data.data?.cards?.length > 0) {
            const card = slotResult.data.data.cards[0];
            const info = `${card.mintBatch || ''}${card.mintNumber || ''}`.trim() || '?';
            session.addLog(`  Slot ${i + 1}: ${info} (Rating ${card.rating || 'N/A'})`, 'success');
            cardsReceived.push({ mintBatch: card.mintBatch, mintNumber: card.mintNumber, rating: card.rating });
          } else {
            session.addLog(`  Slot ${i + 1}: opened`, 'success');
          }
          if (i < slots.length - 1) await new Promise(r => setTimeout(r, 2000));
        }
      }
      successfulCrafts++;
      session.summary.successfulCrafts = successfulCrafts;
      session.summary.cardsReceived = cardsReceived;
      session.setProgress(craftNum, actualCrafts);

      if (craftNum < actualCrafts) await new Promise(r => setTimeout(r, operationDelay));
    } catch (e) {
      session.addLog(`❌ Brew ${craftNum} error: ${e.message}`, 'error');
    }
  }

  const finalFunds = await checkUserFunds();
  if (finalFunds.success) {
    session.summary.finalSilver = finalFunds.balance;
    session.summary.silverSpent = initialSilver - finalFunds.balance;
    session.addLog(`💰 Final silver: ${finalFunds.balance.toLocaleString()}`, 'info');
    session.addLog(`💰 Spent: ${session.summary.silverSpent.toLocaleString()}`, 'info');
  }
  session.summary.cardsReceived = cardsReceived;
  session.addLog(`=== COMPLETE: ${successfulCrafts}/${actualCrafts} brews, ${cardsReceived.length} cards ===`, 'success');
  if (session.state === 'running') session.state = 'completed';
}

// ======================= PACK / FUNDS / COLLECTION HELPERS =======================
async function getUserPacks() {
  if (!userData.jwtToken) return { success: false, error: 'No JWT' };
  const headers = { 'x-user-jwt': userData.jwtToken };
  try {
    let allPacks = [], page = 1, hasMore = true;
    while (hasMore) {
      const result = await makeAPIRequest(`${CONFIG.URL_PACK4EK}?page=${page}&categoryIds=1%2C73`, 'GET', headers);
      if (!result.success) { if (page === 1) return result; break; }
      if (result.data.data?.packs) {
        allPacks = allPacks.concat(result.data.data.packs);
        if (result.data.data.packs.length === 0 || (result.data.data.count * page) >= result.data.data.total) hasMore = false;
        else page++;
      } else hasMore = false;
    }
    return { success: true, data: { packs: allPacks } };
  } catch (e) { return { success: false, error: e.message }; }
}

async function openPack(packId) {
  if (!userData.jwtToken) return { success: false, error: 'No JWT' };
  return makeAPIRequest(CONFIG.URL_PACK0PEN, 'POST',
    { 'x-user-jwt': userData.jwtToken, 'Content-Type': 'application/json' },
    { categoryId: 1, packId });
}

async function checkUserFunds() {
  if (!userData.jwtToken) return { success: false, error: 'No JWT' };
  const result = await makeAPIRequest(CONFIG.URL_NAL, 'GET', { 'x-user-jwt': userData.jwtToken });
  if (result.success && result.data.data) return { success: true, balance: result.data.data.silvercoins || 0 };
  return { success: false, error: result.error };
}

async function getCollectionCards(collectionId, minMintNumber) {
  if (!userData.jwtToken || !CONFIG.MY_ID) return { success: false, error: 'No JWT or MY_ID' };
  const url = `${CONFIG.URL_COLLECTIONS}/${collectionId}/users/${CONFIG.MY_ID}/owned2`;
  const result = await makeAPIRequest(url, 'GET', { 'x-user-jwt': userData.jwtToken });
  if (!result.success) return { success: false, error: result.error };
  let cards = [];
  if (result.data?.data?.cards) cards = result.data.data.cards;
  else if (Array.isArray(result.data?.data)) cards = result.data.data;
  else if (Array.isArray(result.data)) cards = result.data;
  const filtered = cards
    .filter(c => {
      if (minMintNumber && c.mintNumber) return parseInt(c.mintNumber) >= minMintNumber;
      return true;
    })
    .filter(c => c.status === 'available')
    .map(c => ({
      id: c.id, mintBatch: c.mintBatch || '', mintNumber: c.mintNumber || 0,
      status: c.status, rating: c.rating || 'N/A', collectionId
    }));
  return { success: true, cards: filtered };
}

// ======================= MARKET =======================
async function listCardOnMarket(cardId, jwtToken, price) {
  const headers = { 'Content-Type': 'application/json', 'x-user-jwt': jwtToken };
  const body = { id: parseInt(cardId), type: 'card', price: price.toString() };
  const result = await makeAPIRequest(CONFIG.URL_MARKET_LIST, 'POST', headers, body);
  if (result.success && result.data) {
    let marketId = null;
    if (result.data.data?.marketId) marketId = result.data.data.marketId;
    else if (result.data.marketId) marketId = result.data.marketId;
    else if (result.data.data?.data?.marketId) marketId = result.data.data.data.marketId;
    return { success: true, marketId, response: result.data };
  }
  return { success: false, error: result.error || 'Failed', response: result.responseData };
}

async function delistCard(marketId) {
  if (!userData.jwtToken) return { success: false, error: 'No JWT' };
  if (!CONFIG.URL_MARKET_LISTED) return { success: false, error: 'URL_MARKET_LISTED not configured' };
  const url = `${CONFIG.URL_MARKET_LISTED}/${marketId}`;
  const result = await makeAPIRequest(url, 'DELETE', { 'x-user-jwt': userData.jwtToken, 'Content-Type': 'application/json' });
  if (result.success) {
    const ok = result.data?.success === true
      || result.data?.data?.success === true
      || (result.status >= 200 && result.status < 300);
    return { success: ok, response: result.data };
  }
  return { success: false, error: result.error || 'Failed to delist', response: result.responseData };
}

// ======================= SCHEDULING =======================
function scheduleDailyPlan() {
  if (userData._achTimers) userData._achTimers.forEach(t => clearTimeout(t));
  if (userData._dailyRolloverTimer) clearTimeout(userData._dailyRolloverTimer);
  userData._achTimers = [];

  const now = new Date();
  const { effectiveStart, effectiveEnd } = computeEffectiveWindow(now);
  userData._effectiveStartUTC = effectiveStart;
  userData._effectiveEndUTC = effectiveEnd;

  const claim1 = addMinutes(effectiveStart, 15);
  const claim2 = addMinutes(claim1, 2 * 60);
  const claim3 = addMinutes(claim2, 3 * 60);
  const claim4 = addMinutes(claim3, 2 * 60);
  const claim5 = addMinutes(claim4, 3 * 60);
  const claim6 = addMinutes(claim5, 2 * 60);
  const claim7 = addMinutes(effectiveEnd, -15);

  const scheduleClaim = (when, label) => {
    const delay = when.getTime() - Date.now();
    if (delay <= 0) { logActivity(`⏭️ ${label} skipped`); return; }
    const t = setTimeout(async () => {
      try { if (userData.isActive) { logActivity(`🏁 ${label}`); await claimAchievements(); } }
      catch (e) { logActivity(`⚠️ ${label} error: ${e.message}`); }
    }, delay);
    userData._achTimers.push(t);
    logActivity(`⏰ ${label} → ${when.toUTCString()}`);
  };
  scheduleClaim(claim1, 'A4 #1'); scheduleClaim(claim2, 'A4 #2');
  scheduleClaim(claim3, 'A4 #3'); scheduleClaim(claim4, 'A4 #4');
  scheduleClaim(claim5, 'A4 #5'); scheduleClaim(claim6, 'A4 #6');
  scheduleClaim(claim7, 'A4 #7');

  const tomorrow = new Date(now);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const tomorrowStart = utcDateAt(effectiveStart.getUTCHours(), effectiveStart.getUTCMinutes(), 0, 0, tomorrow);
  const rolloverTime = addMinutes(tomorrowStart, 2);
  userData._dailyRolloverTimer = setTimeout(() => {
    logActivity('🔁 Daily rollover');
    scheduleDailyPlan();
  }, Math.max(rolloverTime.getTime() - Date.now(), 1000));
  logActivity(`⏰ Daily rollover → ${rolloverTime.toUTCString()}`);
}

// >>> FIX: do NOT capture sprayerId in a closure. Read the live value each tick.
function startContinuousOperations() {
  setInterval(async () => {
    if (userData.isActive && isWithinActiveWindow()) {
      if (!userData.nextSprayTime || new Date() >= new Date(userData.nextSprayTime)) {
        // getCurrentSprayerId() returns the latest saved value every time
        await executeScheduledSpray(getCurrentSprayerId());
      }
    }
  }, 30000);
  setInterval(async () => {
    if (isWithinActiveWindow() && userData.isActive) await checkFunds();
  }, 5 * 60 * 60 * 1000);
}

async function initialize() {
  try {
    console.log('🚀 INITIALIZING...');
    await refreshToken();
    setTimeout(() => {
      logActivity('🚀 Starting operations');
      scheduleDailyPlan();
      checkFunds();
      startContinuousOperations();
    }, 60000);
  } catch (e) { console.error('❌ Init failed:', e); }
}

// ======================= DATA ACCESS =======================
function getUserData() {
  const safe = { ...userData };
  delete safe._achTimers; delete safe._dailyRolloverTimer;
  if (safe._effectiveStartUTC instanceof Date) safe._effectiveStartUTC = safe._effectiveStartUTC.toISOString();
  if (safe._effectiveEndUTC instanceof Date) safe._effectiveEndUTC = safe._effectiveEndUTC.toISOString();
  return safe;
}
function getActivityLogs(limit = 100) { return userData.logs.slice(0, limit); }
function getDebugLogs(limit = 50) { return debugLogs.slice(0, limit); }

// ======================= EXPRESS =======================
const app = express();
const server = http.createServer(app);
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// User
app.get('/api/user', (req, res) => res.json({
  ...getUserData(),
  config: { sprayerId: getCurrentSprayerId() },
  fundsDetails: lastFundsData
}));
app.get('/api/activity', (req, res) => res.json(getActivityLogs(parseInt(req.query.limit) || 100)));
app.get('/api/debug-logs', (req, res) => res.json(getDebugLogs(parseInt(req.query.limit) || 50)));

// Config
app.get('/api/config', (req, res) => res.json({ sprayerId: getCurrentSprayerId() }));
app.post('/api/config/sprayer-id', (req, res) => {
  const { sprayerId } = req.body;
  if (sprayerId === undefined || isNaN(parseInt(sprayerId))) return res.status(400).json({ success: false, error: 'Invalid ID' });
  const updated = updateSprayerId(sprayerId);
  logActivity(`⚙️ Sprayer ID updated to ${updated} (will be used for all future scheduled sprays)`);
  res.json({ success: true, sprayerId: updated });
});

// Manual triggers
app.post('/api/refresh', async (req, res) => res.json({ success: await refreshToken() }));
app.post('/api/scheduled-spray', async (req, res) => {
  const { sprayerId = getCurrentSprayerId() } = req.body;
  const r = await executeScheduledSpray(sprayerId);
  res.json({ success: !!r, result: r });
});
app.post('/api/claim-achievements', async (req, res) => res.json({ success: true, claimed: await claimAchievements() }));
app.post('/api/check-funds', async (req, res) => {
  const f = await checkFunds();
  res.json({ success: f !== null, funds: f, fundsDetails: lastFundsData });
});

// Manual single spray
app.post('/api/proxy/manual-spray', async (req, res) => {
  const { sprayerId = getCurrentSprayerId() } = req.body;
  res.json(await executeManualSpray(sprayerId));
});

// Spinner info (for prize pool display)
app.get('/api/spinner/info', async (req, res) => {
  const r = await getSpinnerInfo();
  if (r.success) res.json({ success: true, data: r.data.data });
  else res.status(r.status || 500).json({ success: false, error: r.error });
});

// ===== SESSION-BASED SPRAYER =====
app.post('/api/sprayer/start', async (req, res) => {
  try {
    if (!userData.jwtToken || !userData.isActive) return res.status(400).json({ success: false, error: 'No active JWT' });
    const { count = 1, sprayerId = getCurrentSprayerId() } = req.body;
    const n = parseInt(count);
    if (isNaN(n) || n < 1) return res.status(400).json({ success: false, error: 'Invalid count' });

    const session = createSession('sprayer', `${n} sprays`);
    executeMultipleSpraysSession(n, sprayerId, session).catch(e => {
      session.addLog(`❌ Fatal: ${e.message}`, 'error');
      session.state = 'error';
    }).finally(() => {
      session.completedAt = new Date().toISOString();
      if (session.state === 'running') session.state = 'completed';
    });
    res.json({ success: true, sessionId: session.id });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ===== SESSION-BASED PACK OPENER =====
app.post('/api/packs/open/start', async (req, res) => {
  try {
    if (!userData.jwtToken || !userData.isActive) return res.status(400).json({ success: false, error: 'No active JWT' });
    const { packIds } = req.body;
    if (!Array.isArray(packIds) || packIds.length === 0) return res.status(400).json({ success: false, error: 'No pack IDs' });

    const session = createSession('packs', `${packIds.length} packs`);
    executeOpenPacksSession(packIds, session).catch(e => {
      session.addLog(`❌ Fatal: ${e.message}`, 'error');
      session.state = 'error';
    }).finally(() => {
      session.completedAt = new Date().toISOString();
      if (session.state === 'running') session.state = 'completed';
    });
    res.json({ success: true, sessionId: session.id });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ===== SESSION-BASED CRAFTING / BREWING =====
app.post('/api/crafting/start', async (req, res) => {
  try {
    if (!userData.jwtToken || !userData.isActive) return res.status(400).json({ success: false, error: 'No active JWT' });
    const { planId, silvercoins, maxCrafts, minMintNumber, useMintFilter, operationDelay } = req.body;
    const plan = CRAFTING_PLANS[planId];
    if (!plan) return res.status(400).json({ success: false, error: `Unknown plan: ${planId}` });

    const session = createSession('crafting', `${plan.name} × ${maxCrafts || plan.defaultMaxCrafts}`);
    executeCraftingSession(planId, {
      silvercoins: parseInt(silvercoins) || plan.silvercoins,
      maxCrafts: parseInt(maxCrafts) || plan.defaultMaxCrafts,
      minMintNumber: parseInt(minMintNumber) || 30,
      useMintFilter: !!useMintFilter,
      operationDelay: parseInt(operationDelay) || plan.defaultDelay
    }, session).catch(e => {
      session.addLog(`❌ Fatal: ${e.message}`, 'error');
      session.state = 'error';
    }).finally(() => {
      session.completedAt = new Date().toISOString();
      if (session.state === 'running') session.state = 'completed';
    });
    res.json({ success: true, sessionId: session.id, planName: plan.name });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// Plans metadata
app.get('/api/crafting/plans', (req, res) => {
  const out = {};
  for (const [id, p] of Object.entries(CRAFTING_PLANS)) {
    out[id] = {
      id, name: p.name, silvercoins: p.silvercoins,
      defaultMaxCrafts: p.defaultMaxCrafts, defaultDelay: p.defaultDelay,
      requirements: Object.entries(p.requirements).map(([rid, cfg]) => ({
        requirementId: parseInt(rid), cardsPerCraft: cfg.cardsPerCraft, collectionIds: cfg.collectionIds
      }))
    };
  }
  res.json(out);
});

// ===== SESSION ROUTES =====
app.get('/api/session/:id', (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  res.json(serializeSession(s));
});
app.post('/api/session/:id/stop', (req, res) => {
  const s = getSession(req.params.id);
  if (!s) return res.status(404).json({ error: 'Session not found' });
  s.stopRequested = true;
  res.json({ success: true });
});

// ===== PROXY PACKS =====
app.get('/api/proxy/packs', async (req, res) => {
  const r = await getUserPacks();
  if (r.success) res.json(r);
  else res.status(500).json({ error: r.error });
});

app.post('/api/proxy/card-templates', async (req, res) => {
  const { templateIds } = req.body;
  if (!userData.jwtToken || !templateIds?.length) return res.status(400).json({ error: 'Missing args' });
  const r = await makeAPIRequest(`${CONFIG.URL_CARD_TEMPLATE}?ids=${templateIds.join('%2C')}`, 'GET', { 'x-user-jwt': userData.jwtToken });
  r.success ? res.json(r) : res.status(500).json({ error: r.error });
});

// ===== PACK MONITOR =====
app.get('/api/packs/config', (req, res) => res.json(packConfig));
app.post('/api/packs/config', (req, res) => {
  try {
    const { packIds, fetchDelay, refreshIntervalHours } = req.body;
    if (packIds !== undefined) packConfig.packIds = Array.isArray(packIds) ? packIds : [];
    if (fetchDelay !== undefined) packConfig.fetchDelay = parseInt(fetchDelay) || 3000;
    if (refreshIntervalHours !== undefined) packConfig.refreshIntervalHours = parseFloat(refreshIntervalHours) || 3;
    savePackConfigToFile();
    res.json({ success: true, config: packConfig });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.get('/api/packs/:packId', async (req, res) => {
  try {
    const packId = parseInt(req.params.packId);
    if (isNaN(packId)) return res.status(400).json({ success: false, error: 'Invalid ID' });
    if (!userData.jwtToken) return res.status(401).json({ success: false, error: 'No JWT' });
    const r = await makeAPIRequest(`${CONFIG.URL_DROP}/${packId}`, 'GET', { 'x-user-jwt': userData.jwtToken });
    r.success ? res.json({ success: true, data: r.data.data }) : res.status(r.status || 500).json({ success: false, error: r.error });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ===== MARKET =====
app.get('/api/market/status', (req, res) => res.json({ hasToken: !!userData.jwtToken, tokenValid: userData.isActive }));

app.post('/api/market/list', async (req, res) => {
  try {
    const { cardIds, prices, delayMs = 1700 } = req.body;
    if (!Array.isArray(cardIds) || cardIds.length === 0) return res.status(400).json({ success: false, error: 'No card IDs' });
    if (!userData.jwtToken) return res.status(400).json({ success: false, error: 'No JWT' });
    if (!userData.isActive) return res.status(400).json({ success: false, error: 'JWT not active' });

    const results = []; let successful = 0, failed = 0; const marketIds = [];
    for (let i = 0; i < cardIds.length; i++) {
      let price = prices?.[i];
      if (!price && prices?.length > 0) price = prices[prices.length - 1];
      try {
        const r = await listCardOnMarket(cardIds[i], userData.jwtToken, price);
        if (r.success) {
          successful++;
          marketIds.push({ cardId: cardIds[i], marketId: r.marketId, price });
          results.push({ index: i + 1, cardId: cardIds[i], price, success: true, marketId: r.marketId });
        } else {
          failed++;
          results.push({ index: i + 1, cardId: cardIds[i], price, success: false, error: r.error });
        }
      } catch (e) {
        failed++;
        results.push({ index: i + 1, cardId: cardIds[i], price, success: false, error: e.message });
      }
      if (i < cardIds.length - 1 && delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    }
    res.json({ success: true, summary: { total: cardIds.length, successful, failed }, marketIds, results });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

app.post('/api/market/delist', async (req, res) => {
  try {
    const { marketIds, delayMs = 1700 } = req.body;
    if (!Array.isArray(marketIds) || marketIds.length === 0) return res.status(400).json({ success: false, error: 'No market IDs' });
    if (!userData.jwtToken) return res.status(400).json({ success: false, error: 'No JWT' });
    if (!userData.isActive) return res.status(400).json({ success: false, error: 'JWT not active' });
    if (!CONFIG.URL_MARKET_LISTED) return res.status(500).json({ success: false, error: 'URL_MARKET_LISTED not configured' });

    const results = []; let successful = 0, failed = 0;
    for (let i = 0; i < marketIds.length; i++) {
      try {
        const r = await delistCard(marketIds[i]);
        if (r.success) {
          successful++;
          results.push({ index: i + 1, marketId: marketIds[i], success: true });
        } else {
          failed++;
          results.push({ index: i + 1, marketId: marketIds[i], success: false, error: r.error });
        }
      } catch (e) {
        failed++;
        results.push({ index: i + 1, marketId: marketIds[i], success: false, error: e.message });
      }
      if (i < marketIds.length - 1 && delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    }
    res.json({ success: true, summary: { total: marketIds.length, successful, failed }, results });
  } catch (e) { res.status(500).json({ success: false, error: e.message }); }
});

// ===== START =====
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server on :${PORT}`);
  console.log(`💾 Saved sprayer ID: ${getCurrentSprayerId()}`);
  console.log(`🔗 URL_MARKET_LISTED: ${CONFIG.URL_MARKET_LISTED || '(not set)'}`);
  setTimeout(() => initialize(), 5000);
});
process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT', () => { server.close(); process.exit(0); });