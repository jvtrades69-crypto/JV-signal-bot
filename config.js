// config.js
require('dotenv').config();

module.exports = {
  token: process.env.DISCORD_TOKEN,
  clientId: process.env.CLIENT_ID,
  guildId: process.env.GUILD_ID,

  // the owner (you) — used for permissions and for avatar identity
  ownerId: process.env.OWNER_USER_ID || "",

  // ping this role under the signal (optional)
  mentionRoleId: process.env.MENTION_ROLE_ID || "",

  // channel where the single "JV Current Active Trades" summary lives
  currentTradesChannelId: process.env.CURRENT_TRADES_CHANNEL_ID || ""
};
