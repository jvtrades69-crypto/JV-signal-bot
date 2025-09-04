// Reads all configuration from env and exposes a default config object.
import 'dotenv/config';

function req(key) {
  const v = process.env[key];
  if (!v) throw new Error(`Missing required env: ${key}`);
  return v;
}

const cfg = {
  token: req('DISCORD_TOKEN'),
  appId: req('APPLICATION_ID'),
  guildId: req('GUILD_ID'),

  signalsChannelId: req('SIGNALS_CHANNEL_ID'),
  currentTradesChannelId: req('CURRENT_TRADES_CHANNEL_ID'),

  ownerId: req('OWNER_ID'),

  // Optional brand/webhook identity
  brandName: process.env.BRAND_NAME || 'JV Trades',
  brandAvatarUrl: process.env.BRAND_AVATAR_URL || '',
  // You said you don’t want to force any PFP/name -> default false.
  useWebhook: String(process.env.USE_WEBHOOK || 'false').toLowerCase() === 'true',

  // Optional role to ping when posting a signal
  mentionRoleId: process.env.TRADER_ROLE_ID || process.env.MENTION_ROLE_ID || null,

  summaryTitle: '📊 JV Current Active Trades'
};

export default cfg;