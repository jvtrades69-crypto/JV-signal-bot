// config.js (ESM)
import 'dotenv/config';

export const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
export const APPLICATION_ID = process.env.APPLICATION_ID;
export const GUILD_ID = process.env.GUILD_ID;

export const SIGNALS_CHANNEL_ID = process.env.SIGNALS_CHANNEL_ID;
export const CURRENT_TRADES_CHANNEL_ID = process.env.CURRENT_TRADES_CHANNEL_ID;

export const OWNER_ID = process.env.OWNER_ID;

// Branding / webhook identity
export const BRAND_NAME = process.env.BRAND_NAME || 'JV Trades';
export const BRAND_AVATAR_URL = process.env.BRAND_AVATAR_URL || '';
export const USE_WEBHOOK = String(process.env.USE_WEBHOOK || 'true').toLowerCase() === 'true';

// Safety checks
[
  'DISCORD_TOKEN',
  'APPLICATION_ID',
  'GUILD_ID',
  'SIGNALS_CHANNEL_ID',
  'CURRENT_TRADES_CHANNEL_ID',
  'OWNER_ID',
].forEach((k) => {
  if (!eval(k)) console.warn(`[config] Missing ${k} in environment.`);
});
