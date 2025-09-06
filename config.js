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

  ownerId: req('OWNER_USER_ID'),

  // Branding
  brandName: process.env.BRAND_NAME || 'JV Trades',
  brandAvatarUrl: process.env.BRAND_AVATAR_URL || null,

  // Mentions
  mentionRoleId: process.env.MENTION_ROLE_ID || null
};

export default cfg;