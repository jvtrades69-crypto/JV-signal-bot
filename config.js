// Reads all configuration from env and exposes typed constants.
import 'dotenv/config';

const r = (key, fallback = undefined) => {
  const v = process.env[key];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    throw new Error(`Missing required env: ${key}`);
  }
  return v;
};

export const DISCORD_TOKEN = r('DISCORD_TOKEN');
export const APPLICATION_ID = r('APPLICATION_ID');
export const GUILD_ID = r('GUILD_ID');

export const SIGNALS_CHANNEL_ID = r('SIGNALS_CHANNEL_ID');
export const CURRENT_TRADES_CHANNEL_ID = r('CURRENT_TRADES_CHANNEL_ID');

export const OWNER_ID = r('OWNER_ID');

// Optional brand/webhook identity
export const BRAND_NAME = r('BRAND_NAME', 'JV Trades');
export const BRAND_AVATAR_URL = r('BRAND_AVATAR_URL', '');
export const USE_WEBHOOK = String(r('USE_WEBHOOK', 'true')).toLowerCase() === 'true';

// Optional role to ping in signals
export const MENTION_ROLE_ID = process.env.TRADER_ROLE_ID || process.env.MENTION_ROLE_ID || null;

// Titles / strings
export const SUMMARY_TITLE = '📊 JV Current Active Trades';
