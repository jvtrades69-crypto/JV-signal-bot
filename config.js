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

  // Single rolling "Current Trades" message lives here
  currentTradesChannelId: process.env.CURRENT_TRADES_CHANNEL_ID || '',

  // Role to tag at bottom of each trade post
  tradeSignalRoleId: process.env.TRADE_SIGNAL_ROLE_ID || '',

  // Webhook display names
  webhookName: 'JV Trades',
  summaryWebhookName: 'JV Current Trades',

  // true -> controls in a private thread attached to the post (only you)
  // false -> controls as a public reply under the post
  privateControls: (process.env.PRIVATE_CONTROLS || 'true').toLowerCase() === 'true',
};