const { Client, GatewayIntentBits } = require("discord.js");
const WebSocket = require("ws");

// Discord Client Setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// ======================= CHANNEL CONFIGURATION =======================
const DEBUG_CHANNEL_ID = "1400226748611825725";
const CATCH_ALL_CHANNEL_ID = "1400207538498179162";

// Template function to format values with Discord formatting
const formatValue = (value, format = "") => {
  if (value === undefined || value === null) return "";
  
  let formatted = String(value);
  if (format.includes("bold")) formatted = `**${formatted}**`;
  if (format.includes("italic")) formatted = `*${formatted}*`;
  if (format.includes("code")) formatted = `\`${formatted}\``;
  
  return formatted;
};

// Template configuration for each channel
const CHANNEL_CONFIG = [
  // Debug channel (gets all non-filtered messages)
  {
    name: "debug",
    id: DEBUG_CHANNEL_ID,
    event: "all",
    template: (data) => {
      return `**${data.event.toUpperCase()}** | User: ${data.user?.username || "Unknown"} | Type: ${data.entity?.type || "N/A"} | Item: ${data.entity?.itemName || "N/A"} | Price: ${data.market?.price ? `${formatPrice(data.market.price)}` : "N/A"}`;
    },
    condition: (data) =>
      !["pack-opened", "market-list", "market-sold", "pack-purchased"].includes(
        data.event,
      ),
  },

  // Catch-all channel (gets all non-filtered messages in detailed format)
  {
    name: "all",
    id: CATCH_ALL_CHANNEL_ID,
    event: "all",
    template: (data) => {
      return `**${data.event.toUpperCase()}** | User: **${data.user?.username || "Unknown"}** | Type: ${data.entity?.type || "N/A"} | Item: ${data.entity?.itemName || "N/A"} | Mint: ${data.entity?.mintNumber || "N/A"}/${data.entity?.mintBatch || "N/A"} | Price: ${data.market?.price ? `**${formatPrice(data.market.price)}**` : "N/A"}`;
    },
    condition: (data) =>
      !["pack-opened", "market-list", "market-sold", "pack-purchased"].includes(
        data.event,
      ),
  },

  // Pack opened events (mintNumber <= 20)
  {
    name: "feed-20",
    id: "1400226179038056508",
    event: "pack-opened",
    template: (data) => {
      const card = data.cards?.[0];
      return `**${card?.mintBatch || "N/A"}${card?.mintNumber || "N/A"}** ${card?.title || "Unknown"} opened by: ${data.user?.username || "Unknown"} - Pack number ${data?.id} - ${data?.packName} - pack number`;
    },
    condition: (data) => data.cards?.[0]?.mintNumber <= 20,
  },

  // Market listings (cards/stickers < #20)
  {
    name: "listed-20",
    id: "1400226959103099041",
    event: "market-list",
    template: (data) => {
      return `**${data.entity?.mintBatch || "N/A"}${data.entity?.mintNumber || "N/A"}** ${data.entity?.type} ${data.entity?.itemName || "Unknown"} listed by *${data.user?.username || "Unknown"}* for **${formatPrice(data.market?.price)}** - ${data.entity?.id} - Market \`${data.market?.id}\``;
    },
    condition: (data) =>
      ["card", "sticker"].includes(data.entity?.type) &&
      data.entity?.mintNumber < 20,
  },

  // Market listings (cards/stickers < #100)
  {
    name: "listed-100",
    id: "1400227005659615373",
    event: "market-list",
    template: (data) => {
      return `**${data.entity?.mintBatch || "N/A"}${data.entity?.mintNumber || "N/A"}** ${data.entity?.type} ${data.entity?.itemName || "Unknown"} listed by *${data.user?.username || "Unknown"}* for **${formatPrice(data.market?.price)}** - ${data.entity?.id} - Market \`${data.market?.id}\``;
    },
    condition: (data) =>
      ["card", "sticker"].includes(data.entity?.type) &&
      data.entity?.mintNumber < 101 &&
      data.entity?.mintNumber > 20,
  },

  // Pack listings
  {
    name: "listed-packs",
    id: "1400227045677731851",
    event: "market-list",
    template: (data) => {

	      return `${data.entity?.itemName || "Unknown"} listed for **${formatPrice(data.market?.price)}** by *${data.user?.username || "Unknown"}* - ${data.entity?.id} - Market \`${data.market?.id}\``;
    },
    condition: (data) => data.entity?.type === "pack",
  },

  // All listings
  {
    name: "listed-all-cards",
    id: "1400227076539158560",
    event: "market-list",
    template: (data) => {
      return `**${data.entity?.mintBatch || "N/A"}${data.entity?.mintNumber || "N/A"}** ${data.entity?.type} ${data.entity?.itemName || "Unknown"} listed by *${data.user?.username || "Unknown"}* for **${formatPrice(data.market?.price)}** - ${data.entity?.id} - Market \`${data.market?.id}\``;
    },
    condition: (data) => !["pack", "bundle"].includes(data.entity?.type),
  },

  // Sales ≥ $1
  {
    name: "sold-1-usd",
    id: "1400227223658827947",
    event: "market-sold",
    template: (data) => {
      return `💰 **SOLD** | User: **${data.user?.username || "Unknown"}** | Item: **${data.entity?.itemName || "Unknown"}** | Type: ${data.entity?.type} | Mint: #${data.entity?.mintNumber || "N/A"} (Batch ${data.entity?.mintBatch || "N/A"}) | Price: **${formatPrice(data.market?.price)}**`;
    },
    condition: (data) => parseFloat(data.market?.price) >= 1,
  },

  // Pack sales
  {
    name: "sold-packs",
    id: "1400227260857974834",
    event: "market-sold",
    template: (data) => {
      return `💰 **PACK SOLD** | User: **${data.user?.username || "Unknown"}** | Pack: **${data.entity?.itemName || "Unknown"}** | Price: **${formatPrice(data.market?.price)}**`;
    },
    condition: (data) => data.entity?.type === "pack",
  },

  // All sales (non-pack/bundle)
  {
    name: "sold-all",
    id: "1400227291140722778",
    event: "market-sold",
    template: (data) => {
      return `💰 **SOLD** | User: **${data.user?.username || "Unknown"}** | Item: **${data.entity?.itemName || "Unknown"}** | Type: ${data.entity?.type} | Mint: #${data.entity?.mintNumber || "N/A"} (Batch ${data.entity?.mintBatch || "N/A"}) | Price: **${formatPrice(data.market?.price)}**`;
    },
    condition: (data) => !["pack", "bundle"].includes(data.entity?.type),
  },

  // Bundle listings
  {
    name: "list-bundle",
    id: "1400227416885952644",
    event: "market-list",
    template: (data) => {
      return `📦 **BUNDLE LISTED** | User: **${data.user?.username || "Unknown"}** | Bundle: **${data.entity?.itemName || "Unknown"}** | Price: **${formatPrice(data.market?.price)}** | ID: \`${data.market?.id}\``;
    },
    condition: (data) => data.entity?.type === "bundle",
  },

  // Bundle sales
  {
    name: "sold-bundle",
    id: "1400227451585433640",
    event: "market-sold",
    template: (data) => {
      return `💰 **BUNDLE SOLD** | User: **${data.user?.username || "Unknown"}** | Bundle: **${data.entity?.itemName || "Unknown"}** | Price: **${formatPrice(data.market?.price)}**`;
    },
    condition: (data) => data.entity?.type === "bundle",
  },

  // Listings < #20 and ≤ $0.50
  {
    name: "list20-less-50",
    id: "1400237694172532807",
    event: "market-list",
    template: (data) => {
      return `💸 **CHEAP LISTING** | User: **${data.user?.username || "Unknown"}** | Item: **${data.entity?.itemName || "Unknown"}** | Type: ${data.entity?.type} | Mint: #${data.entity?.mintNumber || "N/A"} (Batch ${data.entity?.mintBatch || "N/A"}) | Price: **${formatPrice(data.market?.price)}** | ID: \`${data.market?.id}\``;
    },
    condition: (data) =>
      ["card", "sticker"].includes(data.entity?.type) &&
      data.entity?.mintNumber < 20 &&
      parseFloat(data.market?.price) <= 0.5,
  },

  // Listings < #100 and ≤ $0.15
  {
    name: "list100-less-15",
    id: "1400238804182372382",
    event: "market-list",
    template: (data) => {
      return `💸 **CHEAP LISTING** | User: **${data.user?.username || "Unknown"}** | Item: **${data.entity?.itemName || "Unknown"}** | Type: ${data.entity?.type} | Mint: #${data.entity?.mintNumber || "N/A"} (Batch ${data.entity?.mintBatch || "N/A"}) | Price: **${formatPrice(data.market?.price)}** | ID: \`${data.market?.id}\``;
    },
    condition: (data) =>
      ["card", "sticker"].includes(data.entity?.type) &&
      data.entity?.mintNumber < 100 &&
      parseFloat(data.market?.price) <= 0.15,
  },

  // Store purchases
  {
    name: "store-purchase",
    id: "1400240719423082506",
    event: "pack-purchased",
    template: (data) => {
      return `🛒 **STORE PURCHASE** | User: **${data.user?.username || "Unknown"}** | Pack ID: \`${data.packTemplateId}\` | Amount: ${data.amount}`;
    },
    condition: null,
  },
];

// WebSocket Management
let socket;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// ======================= UTILITY FUNCTIONS =======================
function formatPrice(price) {
  const num = parseFloat(price);
  return num.toFixed(2).replace(/^0+(\d)/, "$1");
}

function shouldProcessEvent(eventName) {
  // Skip these events completely
  const SKIP_EVENTS = ["join-public-feed", "spinner-feed"];
  return !SKIP_EVENTS.includes(eventName);
}
// ====================================================================

function connectWebSocket() {
  socket = new WebSocket(
    "wss://sockets.kolex.gg/socket.io/?EIO=3&transport=websocket",
  );

  socket.on("open", () => {
    console.log("🟢 WebSocket Connected");
    sendToDebugChannel("🟢 WebSocket Connected");
    socket.send('42["join-public-feed"]');
    reconnectAttempts = 0;
  });

  socket.on("close", () => {
    console.log("🔴 WebSocket Disconnected");
    sendToDebugChannel("🔴 WebSocket Disconnected");
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      const delay = Math.min(1000 * reconnectAttempts, 5000);
      setTimeout(connectWebSocket, delay);
      reconnectAttempts++;
    }
  });

  socket.on("error", (err) => {
    console.error("WebSocket Error:", err);
    sendToDebugChannel(`❗ WebSocket Error: ${err.message}`);
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
        eventData.event = eventName; // Add event name to data for templates

        console.log(
          `📦 ${eventName}: ${JSON.stringify(eventData).substring(0, 40)}...`,
        );

        // Skip unwanted events
        if (!shouldProcessEvent(eventName)) return;

        // Process matching channels
        CHANNEL_CONFIG.forEach((config) => {
          if (
            (config.event === "all" || config.event === eventName) &&
            (config.condition === null || config.condition(eventData))
          ) {
            sendToChannel(
              config.id,
              config.template(eventData)
            );
          }
        });
      }
    } catch (error) {
      console.error("Error processing message:", error);
      sendToDebugChannel(`❌ Processing Error: ${error.message}`);
    }
  });
}

function sendToChannel(channelId, message) {
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

// Bot Startup
client.on("ready", () => {
  console.log(`🤖 Logged in as ${client.user.tag}`);
  sendToDebugChannel("🤖 Bot started successfully");
  connectWebSocket();

  setInterval(() => {
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send("2");
    }
  }, 25000);
});

// Add at the bottom of your file (before client.login)
const http = require("http");
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end("Bot is running");
});
server.listen(8080);

client.login(process.env.TOKEN).catch((err) => {
  console.error("Login error:", err);
  process.exit(1);
});
