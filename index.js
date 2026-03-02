const { Client, GatewayIntentBits } = require("discord.js");
const WebSocket = require("ws");
const http = require("http");
const express = require("express");
const path = require("path");

// ======================= OVERRIDE GLOBAL AGENTS TO PREVENT PROXY INTERFERENCE =======================
// This must be done BEFORE any other imports that might set global agents
const https = require('https');
const http = require('http');

// Store original agents
const originalHttpAgent = http.globalAgent;
const originalHttpsAgent = https.globalAgent;

// Reset to default agents (no proxy)
http.globalAgent = new http.Agent({ keepAlive: true });
https.globalAgent = new https.Agent({ 
  keepAlive: true,
  rejectUnauthorized: false 
});

console.log('🌐 HTTP/HTTPS global agents reset to defaults');

// ======================= DISCORD FEED BOT CONFIGURATION =======================
const DEBUG_CHANNEL_ID = "1400226748611825725";
const CATCH_ALL_CHANNEL_ID = "1400207538498179162";

// Filter for Kings League
const KL_KEYWORDS = [
  "España",
  "Split 1",
  "Split 3",
  "Split 5",
  "2023-24",
  "2024-25",
  "SP5",
  "Kings Cup",
  "Queens Cup",
  "KWC Nations",
  "Kings League Spain",
  "Kings League Italy"
];

const KL_HERO = [
  " Hero ",
  "2025 Art Series Team Kit"
];

const KL_MYTH = [
  "Mythic"
];

const KL_PACKS = new Set([
    "Platino 2023-24",
    "Plata 2024-25",
    "Oro 2024-25",
    "Platino 2024-25",
    "Split 1 Rewards",
    "Platino+ 2024-25",
    "Oro+ 2024-25",
    "Plata+ 2024-25",
    "Split 1 Rewards+ 2024-25+",
    "Split 1 Campeones 2024-25",
    "Split 5 Platino",
    "Split 5: Oro 2024-25",
    "Split 5 Plata",
    "Split 5 Rewards",
    "Split 5 Oro",
    "S5 Wild Plata J1 2024-25",
    "S5 Wild Cards J1 2024-25",
    "S5 Rewards 2024-25",
    "S5 Wild Plata J3 2024-25",
    "S5 Wild Cards J3 2024-25",
    "S5 Wild Plata J4 2024-25",
    "S5 Wild Cards J4 2024-25",
    "S5 Wild Plata J5 2024-25",
    "S5 Wild Cards J5 2024-25",
    "S5 Wild Cards J6 2024-25",
    "S5 Wild Plata J6 2024-25",
    "S5 Wild Cards J7",
    "S5 Wild Plata J7",
    "S5 Wild Plata J8",
    "S5 Wild Cards J8",
    "S5 Wild Plata J9",
    "S5 Wild Cards J9",
    "S5 Wild Cards J10",
    "S5 Wild Plata J10",
    "S5 Wild Plata J11",
    "S5 Wild Cards J11",
    "Campeón: Split 3",
    "Pack de Bienvenida+ 2024-25",
    "Pack de Bienvenida 2024-25",
    "Pack de Bienvenida 2023-24",
    "Plata 2023-24",
    "Oro 2023-24",
    "S5 Wild Plata Play-In",
    "S5 Wild Cards Play-In",
    "S5 Wild Cards Cuartos",
    "S5 Wild Plata Cuartos",
    "S5: Campeones",
    "Split 5 Bienvenida",
    "Kings Cup Spain Reward",
    "Kings Cup Germany Reward",
    "Kings Cup Italy Reward",
    "Kings Cup Mexico Reward",
    "Kings Cup MENA Reward",
    "Kings Cup Brazil Rewards",
    "Queens Cup Spain Reward",
    "Queens Cup Mexico Reward",
    "Kings Cup Spain Prestige",
    "Kings Cup Germany Prestige",
    "Kings Cup Italy Prestige",
    "Kings Cup Mexico Prestige",
    "Kings Cup MENA Prestige",
    "Kings Cup Brazil Prestige",
    "Queens Cup Spain Prestige",
    "Queens Cup Mexico Prestige",
    "Kings Cup Spain",
    "Kings Cup Germany",
    "Kings Cup Italy",
    "Kings Cup Mexico",
    "Kings Cup MENA",
    "Kings Cup Brazil",
    "Queens Cup Spain",
    "Queens Cup Mexico",
    "Queens Cup Mexico Reward",
    "Queens Cup Spain Reward",
    "Kings Cup MENA Reward",
    "Kings Cup Mexico Reward",
    "Kings Cup Brazil Rewards",
    "Kings Cup Germany Reward",
    "Kings Cup Italy Reward",
    "Kings Cup Spain Reward",
    "Kings Cup Spain Coentrão Prestige",
    "Kings Cup Spain Coentrão",
    "Kings Cup Germany Prestige",
    "Kings Cup Germany",
    "Kings Cup America Champions",
    "Kings Cup Europe Champions",
    "Queens Cup Champions",
    "Kings World Cup Nations: Prestige",
    "Kings World Cup Nations",
    "Kings World Cup Nations: Reward"
]);

// Custom WebSocket that explicitly avoids proxy
class NoProxyWebSocket extends WebSocket {
  constructor(address, options = {}) {
    // Force no proxy and disable any agent
    super(address, {
      ...options,
      agent: false,
      rejectUnauthorized: false,
      perMessageDeflate: false
    });
  }
}

// Discord Client Setup - with explicit transport and no proxy
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  // Force REST mode and disable any proxy
  rest: {
    agent: null,
    rejectUnauthorized: false,
    timeout: 30000
  },
  ws: {
    agent: null,
    rejectUnauthorized: false
  }
});

// Format price helper
function formatPrice(price) {
  const num = parseFloat(price);
  return num.toFixed(2).replace(/^0+(\d)/, "$1");
}

// Channel configuration (keep your existing CHANNEL_CONFIG here - it's long so I'll omit it for brevity)
// ... (your existing CHANNEL_CONFIG array)

// ======================= WEBSOCKET MANAGEMENT =======================
let socket;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

function shouldProcessEvent(eventName) {
  const SKIP_EVENTS = ["join-public-feed"];
  return !SKIP_EVENTS.includes(eventName);
}

function sendToChannel(channelId, message) {
  if (!message) return;
  const channel = client.channels.cache.get(channelId);
  if (channel) {
    channel.send(message).catch((err) => {
      console.error(`Error sending to channel ${channelId}:`, err);
    });
  }
}

function sendToDebugChannel(message) {
  sendToChannel(DEBUG_CHANNEL_ID, message);
}

function connectWebSocket() {
  // Use NoProxyWebSocket to ensure no proxy
  socket = new NoProxyWebSocket(
    "wss://sockets.kolex.gg/socket.io/?EIO=3&transport=websocket",
  );

  socket.on("open", () => {
    console.log("🟢 Feed WebSocket Connected");
    socket.send('42["join-public-feed"]');
    reconnectAttempts = 0;
    sendToDebugChannel("✅ Feed WebSocket connected successfully");
  });

  socket.on("close", (code, reason) => {
    console.log(`🔴 Feed WebSocket Disconnected - Code: ${code}, Reason: ${reason}`);
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 30000);
      console.log(`🔄 Reconnecting in ${delay}ms (attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})`);
      setTimeout(connectWebSocket, delay);
      reconnectAttempts++;
    } else {
      console.log('❌ Max reconnection attempts reached');
      sendToDebugChannel('❌ Feed WebSocket max reconnection attempts reached');
    }
  });

  socket.on("error", (err) => {
    console.error("Feed WebSocket Error:", err.message);
  });

  socket.on("message", (rawData) => {
    try {
      const data = rawData.toString();
      if (data === "3") {
        socket.send("3");
        return;
      }

      if (data.startsWith("42")) {
        const [eventName, eventData] = JSON.parse(data.substring(2));
        eventData.event = eventName;

        if (!shouldProcessEvent(eventName)) return;

        CHANNEL_CONFIG.forEach((config) => {
          if (
            (config.event === "all" || config.event === eventName) &&
            (config.condition === null || config.condition(eventData))
          ) {
            const message = config.template(eventData);
            if (message) {
              sendToChannel(config.id, message);
            }
          }
        });
      }
    } catch (error) {
      console.error("Error processing message:", error);
    }
  });
}

// ======================= EXPRESS SERVER (SPIN TOOL) =======================
const app = express();
const server = http.createServer(app);

// Import spin service
const spinService = require('./spray-service');

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ======================= SPIN SERVICE API ROUTES =======================
// ... (keep all your existing API routes)

// ======================= DISCORD BOT SETUP =======================
client.on("ready", () => {
  console.log(`🤖 Feed Bot logged in as ${client.user.tag}`);
  console.log(`🤖 Bot is in ${client.guilds.cache.size} guilds`);
  sendToDebugChannel("🤖 Feed Bot started successfully");
  
  // Start WebSocket connection after Discord is ready
  setTimeout(() => {
    connectWebSocket();
  }, 2000);

  // Keep WebSocket alive
  setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send("2");
    }
  }, 25000);
});

client.on("error", (error) => {
  console.error("🤖 Discord client error:", error);
});

client.on("debug", (info) => {
  if (process.env.DEBUG === 'true') {
    console.log("🤖 Discord debug:", info);
  }
});

// ======================= START EVERYTHING =======================
const PORT = process.env.PORT || 8080;

server.listen(PORT, () => {
  console.log(`🚀 Combined server running on http://localhost:${PORT}`);
  console.log(`📊 Dashboard: http://localhost:${PORT}`);
  console.log(`🛠️  Tools: http://localhost:${PORT}/tools.html`);
  
  // Login to Discord with explicit options
  console.log('🤖 Attempting Discord login...');
  
  client.login(process.env.TOKEN)
    .then(() => {
      console.log('🤖 Discord login successful');
    })
    .catch((err) => {
      console.error("❌ Discord login error:", err);
      console.error("❌ Please check your Discord token and network connectivity");
      // Don't exit, let the spin service continue running
    });
  
  // Initialize spin service (delayed to ensure token refresh first)
  setTimeout(() => {
    spinService.initialize();
  }, 5000);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  if (socket) socket.close();
  client.destroy();
  server.close();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  if (socket) socket.close();
  client.destroy();
  server.close();
  process.exit(0);
});