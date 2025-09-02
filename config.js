const dotenv = require('dotenv');
dotenv.config();

function req(name) {
  const v = process.env[name];
  if (!v || !v.trim()) {
    console.warn(`[WARN] ${name} is not set.`);
  }
  return v;
}

module.exports = {
  token: req('DISCORD_TOKEN'),
  clientId: req('CLIENT_ID'),
  guildId: req('GUILD_ID'),
  ownerId: process.env.OWNER_ID || '',
  allowedRoleId: process.env.ALLOWED_ROLE_ID || '',
};
