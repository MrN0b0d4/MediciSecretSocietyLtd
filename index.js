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

//filter for Kings League
const KL_KEYWORDS = [
  "España",
  "Split 1",
  "Split 3",
  "Split 5",
  "2023-24",
  "2024-25",
  "SP5",
  "Kings Cup",
  "Queens Cup"
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
	"Queens Cup Mexico Reward"
]);


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
      !["pack-opened", "market-list", "market-sold", "pack-purchased", "spinner-feed"].includes(
        data.event,
      ),
  },
  

  // Catch-all channel (gets all non-filtered messages in detailed format)
  {
    name: "all",
    id: CATCH_ALL_CHANNEL_ID,
    event: "all",
    template: (data) => {
      return `**${data.event.toUpperCase()}** | User: **${data.user?.username || "Unknown"}** | message: ${data}`;
    },
    condition: (data) =>
      !["pack-opened", "market-list", "market-sold", "pack-purchased", "spinner-feed"].includes(
        data.event,
      ),
  },

// ======================= CS CHANNELS =======================
// ======================= CS CHANNELS =======================
// ======================= CS CHANNELS =======================

  // Pack opened events (mintNumber <= 30)
  
  {
  name: "feed-30",
  id: "1400226179038056508",
  event: "pack-opened",
  template: (data) => {
    const matchingCards = data.cards?.filter(card => card.mintNumber <= 30) || [];

    if (matchingCards.length === 0) return null; // No matching cards

    return matchingCards.map(card => 
      `**${card.mintBatch || "N/A"}${card.mintNumber || "N/A"}** ${card.title || "Unknown"} opened by: *${data.user?.username || "Unknown"}* - Pack ID ${data?.id} - ${data?.packName}`
    ).join("\n");
  },
  condition: (data) => data.cards?.some(card => card.mintNumber <= 30) &&
  !KL_PACKS.has(data?.packName),
},

  // Market listings (cards/stickers < #20)
  {
    name: "listed-20",
    id: "1400226959103099041",
    event: "market-list",
    template: (data) => {
      return `**${data.entity?.mintBatch || "N/A"}${data.entity?.mintNumber || "N/A"}** ${data.entity?.type} ${data.entity?.itemName || "Unknown"} listed by *${data.user?.username || "Unknown"}* for **${formatPrice(data.market?.price)}** - ${data.entity?.id} - [Market](<https://kolex.gg/market/${data.entity?.type}/${data.entity?.templateId}?sort=mint>) \`${data.market?.id}\``;
    },
//    condition: (data) =>
//      ["card", "sticker"].includes(data.entity?.type) &&
//      data.entity?.mintNumber < 20,
    condition: (data) => {
	const name = data.entity?.itemName || "";
	return ["card", "sticker"].includes(data.entity?.type) &&
    data.entity?.mintNumber < 20 &&
	!KL_KEYWORDS.some(kw => name.includes(kw));
	}		  
  },

  // Market listings (cards/stickers < #100)
  {
    name: "listed-100",
    id: "1400227005659615373",
    event: "market-list",
    template: (data) => {
      return `**${data.entity?.mintBatch || "N/A"}${data.entity?.mintNumber || "N/A"}** ${data.entity?.type} ${data.entity?.itemName || "Unknown"} listed by *${data.user?.username || "Unknown"}* for **${formatPrice(data.market?.price)}** - ${data.entity?.id} - [Market](<https://kolex.gg/market/${data.entity?.type}/${data.entity?.templateId}?sort=mint>) \`${data.market?.id}\``;
    },
    //condition: (data) =>
    //  ["card", "sticker"].includes(data.entity?.type) &&
    //  data.entity?.mintNumber < 101 &&
    //  data.entity?.mintNumber > 20,
    condition: (data) => {
	const name = data.entity?.itemName || "";
	return ["card", "sticker"].includes(data.entity?.type) &&
    data.entity?.mintNumber < 101 &&
    data.entity?.mintNumber > 20 &&
	!KL_KEYWORDS.some(kw => name.includes(kw));
	}		  
  },

  // Pack listings
  {
    name: "listed-packs",
    id: "1400227045677731851",
    event: "market-list",
    template: (data) => {

	      return `${data.entity?.itemName || "Unknown"} listed for **${formatPrice(data.market?.price)}** by *${data.user?.username || "Unknown"}* - ${data.entity?.id} - Market \`${data.market?.id}\``;
    },
    condition: (data) => data.entity?.type === "pack" &&
	parseFloat(data.market?.price) > 0.15 &&
	!KL_PACKS.has(data.entity?.itemName),
  },
  
  // Pack listings for less than 15 cent
  {
    name: "listed-packs-15c",
    id: "1423667054317277235",
    event: "market-list",
    template: (data) => {

	      return `${data.entity?.itemName || "Unknown"} listed for **${formatPrice(data.market?.price)}** by *${data.user?.username || "Unknown"}* - ${data.entity?.id} - Market \`${data.market?.id}\``;
    },
    condition: (data) => data.entity?.type === "pack" &&
	parseFloat(data.market?.price) <= 0.15 &&
	!KL_PACKS.has(data.entity?.itemName),
  },

  // All listings
  {
    name: "listed-all-cards",
    id: "1400227076539158560",
    event: "market-list",
    template: (data) => {
      return `**${data.entity?.mintBatch || "N/A"}${data.entity?.mintNumber || "N/A"}** ${data.entity?.type} ${data.entity?.itemName || "Unknown"} listed by *${data.user?.username || "Unknown"}* for **${formatPrice(data.market?.price)}** - ${data.entity?.id} - [Market](<https://kolex.gg/market/${data.entity?.type}/${data.entity?.templateId}?sort=mint>) \`${data.market?.id}\``;
    },
    //condition: (data) => !["pack", "bundle"].includes(data.entity?.type),
    condition: (data) => {
	const name = data.entity?.itemName || "";
	return !["pack", "bundle"].includes(data.entity?.type) &&
	!KL_KEYWORDS.some(kw => name.includes(kw));
	}		
	
  },

  // Sales ≥ $1
  {
    name: "sold-1-usd",
    id: "1400227223658827947",
    event: "market-sold",
	
	template: (data) => {
      return `**${data.entity?.mintBatch || "N/A"}${data.entity?.mintNumber || "N/A"}** ${data.entity?.type} ${data.entity?.itemName || "Unknown"} bought by *${data.user?.username || "Unknown"}* for **${formatPrice(data.market?.price)}** - ${data.entity?.id}`;
    },
	
    //condition: (data) => 
	//["card", "sticker"].includes(data.entity?.type) &&
	//parseFloat(data.market?.price) >= 1,
	
    condition: (data) => {
	const name = data.entity?.itemName || "";
	return ["card", "sticker"].includes(data.entity?.type) &&
	parseFloat(data.market?.price) >= 1 &&
	!KL_KEYWORDS.some(kw => name.includes(kw));
	}		
	
  },

  // Pack sales
  {
    name: "sold-packs",
    id: "1400227260857974834",
    event: "market-sold",
	
	template: (data) => {
      return `*${data.user?.username || "Unknown"}* bought ${data.entity?.itemName || "Unknown"} for **${formatPrice(data.market?.price)}** - ${data.entity?.id}`;
    },
	
    condition: (data) => data.entity?.type === "pack" &&
	parseFloat(data.market?.price) > 0.11 &&
	!KL_PACKS.has(data.entity?.itemName),
  },
  
  // Pack sales for 10 cents
  {
    name: "sold-packs",
    id: "1423666913577402398",
    event: "market-sold",
	
	template: (data) => {
      return `*${data.user?.username || "Unknown"}* bought ${data.entity?.itemName || "Unknown"} for **${formatPrice(data.market?.price)}** - ${data.entity?.id}`;
    },
	
    condition: (data) => data.entity?.type === "pack" &&
	parseFloat(data.market?.price) <= 0.11 &&
	!KL_PACKS.has(data.entity?.itemName),
  },

  // All sales (non-pack/bundle)
  {
    name: "sold-all",
    id: "1400227291140722778",
    event: "market-sold",
	
	template: (data) => {
      return `**${data.entity?.mintBatch || "N/A"}${data.entity?.mintNumber || "N/A"}** ${data.entity?.type} ${data.entity?.itemName || "Unknown"} bought by *${data.user?.username || "Unknown"}* for **${formatPrice(data.market?.price)}** - ${data.entity?.id}`;
    },
	
    //condition: (data) => !["pack", "bundle"].includes(data.entity?.type),
    condition: (data) => {
		const name = data.entity?.itemName || "";
		return !["pack", "bundle"].includes(data.entity?.type) &&
		!KL_KEYWORDS.some(kw => name.includes(kw));
	}	
	
	
  },
 
// ======================= Kings League  CHANNELS =======================
// ======================= Kings League  CHANNELS =======================
// ======================= Kings League  CHANNELS =======================
 

  // KL Pack opened events (mintNumber <= 50)
  
  {
  name: "kl-feed-50",
  id: "1428002013798727791",
  event: "pack-opened",
  template: (data) => {
    const matchingCards = data.cards?.filter(card => card.mintNumber <= 50) || [];

    if (matchingCards.length === 0) return null; // No matching cards

    return matchingCards.map(card => 
      `**${card.mintBatch || "N/A"}${card.mintNumber || "N/A"}** ${card.title || "Unknown"} opened by: *${data.user?.username || "Unknown"}* - Pack ID ${data?.id} - ${data?.packName}`
    ).join("\n");
  },
  condition: (data) => data.cards?.some(card => card.mintNumber <= 50) &&
  KL_PACKS.has(data?.packName),
},

  // KL Market listings (cards/stickers < #150)
  {
    name: "kl-listed-150",
    id: "1428000363742629992",
    event: "market-list",
    template: (data) => {
      return `**${data.entity?.mintBatch || "N/A"}${data.entity?.mintNumber || "N/A"}** ${data.entity?.type} ${data.entity?.itemName || "Unknown"} listed by *${data.user?.username || "Unknown"}* for **${formatPrice(data.market?.price)}** - ${data.entity?.id} - [Market](<https://kolex.gg/market/${data.entity?.type}/${data.entity?.templateId}?sort=mint>) \`${data.market?.id}\``;
    },
//    condition: (data) =>
//      ["card", "sticker"].includes(data.entity?.type) &&
//      data.entity?.mintNumber < 20,
    condition: (data) => {
	const name = data.entity?.itemName || "";
	return ["card", "sticker"].includes(data.entity?.type) &&
    data.entity?.mintNumber < 151 &&
	KL_KEYWORDS.some(kw => name.includes(kw));
	}		  
  },

  // KL Pack listings
  {
    name: "kl-listed-packs",
    id: "1428001329741041735",
    event: "market-list",
    template: (data) => {

	      return `${data.entity?.itemName || "Unknown"} listed for **${formatPrice(data.market?.price)}** by *${data.user?.username || "Unknown"}* - ${data.entity?.id} - Market \`${data.market?.id}\``;
    },
    condition: (data) => data.entity?.type === "pack" &&
	parseFloat(data.market?.price) > 0.15 &&
	KL_PACKS.has(data.entity?.itemName),
  },
  
  // KL Pack listings for less than 15 cent
  {
    name: "kl-listed-packs-15c",
    id: "1428001258446520350",
    event: "market-list",
    template: (data) => {

	      return `${data.entity?.itemName || "Unknown"} listed for **${formatPrice(data.market?.price)}** by *${data.user?.username || "Unknown"}* - ${data.entity?.id} - Market \`${data.market?.id}\``;
    },
    condition: (data) => data.entity?.type === "pack" &&
	parseFloat(data.market?.price) <= 0.15 &&
	KL_PACKS.has(data.entity?.itemName),
  },

  // KL All listings
  {
    name: "kl-listed-all-cards",
    id: "1428001382396334110",
    event: "market-list",
    template: (data) => {
      return `**${data.entity?.mintBatch || "N/A"}${data.entity?.mintNumber || "N/A"}** ${data.entity?.type} ${data.entity?.itemName || "Unknown"} listed by *${data.user?.username || "Unknown"}* for **${formatPrice(data.market?.price)}** - ${data.entity?.id} - [Market](<https://kolex.gg/market/${data.entity?.type}/${data.entity?.templateId}?sort=mint>) \`${data.market?.id}\``;
    },
    //condition: (data) => !["pack", "bundle"].includes(data.entity?.type),
    condition: (data) => {
	const name = data.entity?.itemName || "";
	return !["pack", "bundle"].includes(data.entity?.type) &&
	KL_KEYWORDS.some(kw => name.includes(kw));
	}		
	
  },

  // KL Sales ≥ $5
  {
    name: "kl-sold-5-usd",
    id: "1428001770810118164",
    event: "market-sold",
	
	template: (data) => {
      return `**${data.entity?.mintBatch || "N/A"}${data.entity?.mintNumber || "N/A"}** ${data.entity?.type} ${data.entity?.itemName || "Unknown"} bought by *${data.user?.username || "Unknown"}* for **${formatPrice(data.market?.price)}** - ${data.entity?.id}`;
    },
	
    //condition: (data) => 
	//["card", "sticker"].includes(data.entity?.type) &&
	//parseFloat(data.market?.price) >= 1,
	
    condition: (data) => {
	const name = data.entity?.itemName || "";
	return ["card", "sticker"].includes(data.entity?.type) &&
	parseFloat(data.market?.price) >= 5 &&
	KL_KEYWORDS.some(kw => name.includes(kw));
	}		
	
  },

  // KL Pack sales
  {
    name: "kl-sold-packs",
    id: "1428001821779300532",
    event: "market-sold",
	
	template: (data) => {
      return `*${data.user?.username || "Unknown"}* bought ${data.entity?.itemName || "Unknown"} for **${formatPrice(data.market?.price)}** - ${data.entity?.id}`;
    },
	
    condition: (data) => data.entity?.type === "pack" &&
	parseFloat(data.market?.price) > 0.11 &&
	KL_PACKS.has(data.entity?.itemName),
  },
  
  // KL Pack sales for 10 cents
  {
    name: "kl-sold-packs",
    id: "1428001877504823376",
    event: "market-sold",
	
	template: (data) => {
      return `*${data.user?.username || "Unknown"}* bought ${data.entity?.itemName || "Unknown"} for **${formatPrice(data.market?.price)}** - ${data.entity?.id}`;
    },
	
    condition: (data) => data.entity?.type === "pack" &&
	parseFloat(data.market?.price) <= 0.11 &&
	KL_PACKS.has(data.entity?.itemName),
  },

    // KL sales all
  {
    name: "KL-sold-all",
    id: "1428001908781748344",
    event: "market-sold",
	
	template: (data) => {
      return `**${data.entity?.mintBatch || "N/A"}${data.entity?.mintNumber || "N/A"}** ${data.entity?.type} ${data.entity?.itemName || "Unknown"} bought by *${data.user?.username || "Unknown"}* for **${formatPrice(data.market?.price)}** - ${data.entity?.id}`;
    },
	
    condition: (data) => {
		const name = data.entity?.itemName || "";
		return !["pack", "bundle"].includes(data.entity?.type) &&
		KL_KEYWORDS.some(kw => name.includes(kw));
	}
  },

// <<<<<--- Kings League 




  // Bundle listings
  {
    name: "list-bundle",
    id: "1400227416885952644",
    event: "market-list",
    template: (data) => {
      return `📦 *${data.user?.username || "Unknown"}* listed a bundle *${data.entity?.itemName || "Unknown"}* for **${formatPrice(data.market?.price)}** - #${data.entity?.id} - ID \`${data?.id}\``;
    },
    condition: (data) => data.entity?.type === "bundle",
  },

  // Bundle sales
  {
    name: "sold-bundle",
    id: "1400227451585433640",
    event: "market-sold",
    template: (data) => {
      return `💰 *${data.user?.username || "Unknown"}* bought a bundle *${data.entity?.itemName || "Unknown"}* for **${formatPrice(data.market?.price)}** - #${data.entity?.id} - ID \`${data?.id}\``;
    },
    condition: (data) => data.entity?.type === "bundle",
  },

  // Listings < #20 and ≤ $0.50
  {
    name: "list20-less-50",
    id: "1400237694172532807",
    event: "market-list",
    template: (data) => {
      return `💸 **${data.entity?.mintBatch || "N/A"}${data.entity?.mintNumber || "N/A"}** ${data.entity?.type} ${data.entity?.itemName || "Unknown"} listed by *${data.user?.username || "Unknown"}* for **${formatPrice(data.market?.price)}** - ${data.entity?.id} - [Market](<https://kolex.gg/market/${data.entity?.type}/${data.entity?.templateId}?sort=mint>) \`${data.market?.id}\``;
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
      return `💸 **${data.entity?.mintBatch || "N/A"}${data.entity?.mintNumber || "N/A"}** ${data.entity?.type} ${data.entity?.itemName || "Unknown"} listed by *${data.user?.username || "Unknown"}* for **${formatPrice(data.market?.price)}** - ${data.entity?.id} - [Market](<https://kolex.gg/market/${data.entity?.type}/${data.entity?.templateId}?sort=mint>) \`${data.market?.id}\``;
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
      return `🛒 *${data.user?.username || "Unknown"}* bought ${data.amount} pack(s) \`${data.packTemplateId}\``;
    },
    condition: null,
  },
  
  // Spinner
  {
    name: "spinner",
    id: "1423670126741426176",
    event: "spinner-feed",
    template: (data) => {
      return `*${data.user?.username || "Unknown"}* received ${data?.name} from spinner`;
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
  const SKIP_EVENTS = ["join-public-feed"];
  return !SKIP_EVENTS.includes(eventName);
}
// ====================================================================

function connectWebSocket() {
  socket = new WebSocket(
    "wss://sockets.kolex.gg/socket.io/?EIO=3&transport=websocket",
  );

  socket.on("open", () => {
    console.log("🟢 WebSocket Connected");
    //sendToDebugChannel("🟢 WebSocket Connected");
    socket.send('42["join-public-feed"]');
    reconnectAttempts = 0;
  });

  socket.on("close", () => {
    console.log("🔴 WebSocket Disconnected");
    //sendToDebugChannel("🔴 WebSocket Disconnected");
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



