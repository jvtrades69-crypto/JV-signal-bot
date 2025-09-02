const dotenv = require('dotenv');
dotenv.config();

function need(name) {
  const v = process.env[name];
  if (!v || !v.trim()) console.warn(`[WARN] ${name} is not set.`);
  return v;
}

module.exports = {
  token: need('DISCORD_TOKEN'),
  clientId: need('CLIENT_ID'),
  guildId: need('GUILD_ID'),

  ownerId: process.env.OWNER_ID || '',
  allowedRoleId: process.env.ALLOWED_ROLE_ID || '',

  // Summary goes ONLY to this channel (single rolling message)
  currentTradesChannelId: process.env.CURRENT_TRADES_CHANNEL_ID || '',

  // Role to tag at the bottom of each trade post
  tradeSignalRoleId: process.env.TRADE_SIGNAL_ROLE_ID || '',

  // Name for the per-channel posting webhook (used for the clean, non-APP look)
  webhookName: 'JV Trades',

  // If "true", create a *private thread* attached to the trade post and put controls in there (only you see it).
  // If "false", reply under the trade with a normal bot message (visible to everyone).
  privateControls: (process.env.PRIVATE_CONTROLS || 'false').toLowerCase() === 'true',
};
