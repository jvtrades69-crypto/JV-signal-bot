// index.js — JV Signal Bot (fixed: More Updates menu directly shows modals, no double replies)

import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  StringSelectMenuBuilder,
} from 'discord.js';

import { customAlphabet } from 'nanoid';
import config from './config.js';
import {
  saveSignal, getSignal, getSignals, updateSignal, deleteSignal,
  getThreadId, setThreadId
} from './store.js';

import {
  renderSignalText,
  renderSummaryText,
} from './embeds.js';

const nano = customAlphabet('1234567890abcdef', 10);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });

// ---- global error catcher so bot doesn’t crash ----
process.on('unhandledRejection', (err) => console.error('unhandledRejection:', err));
process.on('uncaughtException', (err) => console.error('uncaughtException:', err));

// ------------------------------
// (… keep all your functions exactly as before …)
// ------------------------------

// the only change is at the **More Updates menu section**
client.on('interactionCreate', async (interaction) => {
  try {
    // … all your existing handlers stay the same …

    // Handle More Updates menu selections (fixed)
    if (interaction.isStringSelectMenu() && interaction.customId.startsWith('menu_more_')) {
      const id = interaction.customId.replace('menu_more_', '');
      const value = interaction.values[0];

      if (value === 'more_tp45') {
        return interaction.showModal(makeTp45Modal(id));
      }
      if (value === 'more_plans') {
        return interaction.showModal(makePlansModal(id));
      }
      if (value === 'more_meta') {
        return interaction.showModal(makeMetaModal(id));
      }

      return interaction.reply({ content: 'No action.', ephemeral: true });
    }
  } catch (err) {
    console.error('interaction error:', err);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: '❌ Internal error.' });
      } else {
        await interaction.reply({ content: '❌ Internal error.', ephemeral: true });
      }
    } catch {}
  }
});

// (rest of your createSignal, sendMinimalPing, client.login stays the same)
