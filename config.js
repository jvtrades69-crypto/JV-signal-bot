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
  webhookName: 'JV Trades' // per-channel webhook display name
};
