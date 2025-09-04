// config.js
import dotenv from "dotenv";
dotenv.config();

function req(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`❌ Missing env var: ${name}`);
  }
  return v;
}

export default {
  // Tokens & IDs
  token: req("DISCORD_TOKEN"),
  appId: req("APPLICATION_ID"),
  guildId: req("GUILD_ID"),

  // Channels
  signalsChannelId: req("SIGNALS_CHANNEL_ID"),
  currentTradesChannelId: req("CURRENT_TRADES_CHANNEL_ID"),

  // Owner / role
  ownerId: req("OWNER_ID"),
  traderRoleId: process.env.TRADER_ROLE_ID || null,

  // Branding
  brandName: process.env.BRAND_NAME || "JV Trades"
};