import dotenv from "dotenv";
dotenv.config();

export const config = {
  token: process.env.DISCORD_TOKEN,
  appId: process.env.APPLICATION_ID,
  guildId: process.env.GUILD_ID,

  signalsChannelId: process.env.SIGNALS_CHANNEL_ID,
  currentTradesChannelId: process.env.CURRENT_TRADES_CHANNEL_ID,

  ownerId: process.env.OWNER_ID || null,

  brandName: process.env.BRAND_NAME || "JV Trades",
  brandAvatarUrl:
    process.env.BRAND_AVATAR_URL || "https://your-logo-or-avatar.png",
  useWebhook: String(process.env.USE_WEBHOOK || "true").toLowerCase() === "true",
};