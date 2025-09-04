require("dotenv").config();

module.exports = {
  token: process.env.DISCORD_TOKEN,
  guildId: process.env.GUILD_ID,
  currentTradesChannelId: process.env.CURRENT_TRADES_CHANNEL_ID,
  mentionRoleId: process.env.MENTION_ROLE_ID || "", // optional
  ownerUserId: process.env.OWNER_ID,
};
