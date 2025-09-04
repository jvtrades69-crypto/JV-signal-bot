import dotenv from "dotenv";
dotenv.config();

function get(name, required = true) {
  let v = process.env[name];
  if (typeof v === "string") v = v.trim();
  if (!v && required) console.error(`❌ Missing env var: ${name}`);
  return v;
}

export default {
  token: get("DISCORD_TOKEN"),
  appId: get("APPLICATION_ID"),
  guildId: get("GUILD_ID"),

  signalsChannelId: get("SIGNALS_CHANNEL_ID"),
  currentTradesChannelId: get("CURRENT_TRADES_CHANNEL_ID"),

  ownerId: get("OWNER_ID"),
  traderRoleId: get("TRADER_ROLE_ID", false) || null,

  brandName: get("BRAND_NAME", false) || "JV Trades",
  brandAvatarUrl: get("BRAND_AVATAR_URL", false) || null,
  useWebhook: (get("USE_WEBHOOK", false) || "false").toLowerCase() === "true"
};
