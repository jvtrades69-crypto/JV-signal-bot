const dotenv = require('dotenv');
dotenv.config();

function requireEnv(name) {
  const v = process.env[name];
  if (!v || v.trim() === '') console.warn(`[WARN] ${name} is not set.`);
  return v;
}

module.exports = {
  // Required
  token: requireEnv('DISCORD_TOKEN'),
  clientId: requireEnv('CLIENT_ID'),
  guildId: requireEnv('GUILD_ID'),

  // Optional: keeping for backward compatibility, but NOT required anymore
  signalChannelId: process.env.SIGNAL_CHANNEL_ID || '',

  // Optional permissions
  ownerId: process.env.OWNER_ID || '',
  allowedRoleId: process.env.ALLOWED_ROLE_ID || '',
};
