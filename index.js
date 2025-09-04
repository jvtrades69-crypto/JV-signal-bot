// index.js — JV Signal Bot (safe + robust glue file)
import 'dotenv/config';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Colors,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionFlagsBits,
  REST,
  Routes,
} from 'discord.js';
import { v4 as uuidv4 } from 'uuid';

// your helpers
import {
  renderSignalEmbed,
  renderSummaryEmbed,
} from './embeds.js';
import {
  saveSignal,
  getSignal,
  updateSignal,
  deleteSignal,
  listActive,
  getSummaryMessageId,
  setSummaryMessageId,
  setOwnerPanelMessageId,
  getOwnerPanelMessageId,
} from './store.js';

// --------- ENV ----------
const {
  DISCORD_TOKEN,
  GUILD_ID,
  SIGNALS_CHANNEL_ID,
  CURRENT_TRADES_CHANNEL_ID,
  OWNER_ID,
  TRADER_ROLE_ID,
  BRAND_NAME = 'JV Trades',
  BRAND_AVATAR_URL,
  USE_WEBHOOK = 'true',
} = process.env;

// --------- Crash guards ----------
process.on('unhandledRejection', (err) => console.error('UNHANDLED REJECTION:', err));
process.on('uncaughtException', (err) => console.error('UNCAUGHT EXCEPTION:', err));

// --------- Client (safe intents only) ----------
const client = new Client({
  intents: [GatewayIntentBits.Guilds], // no privileged intents
});

client.on('error', (e) => console.error('CLIENT ERROR:', e));
client.on('shardError', (e) => console.error('SHARD ERROR:', e));
setInterval(() => console.log('[heartbeat] bot alive'), 60_000);

// --------- Command schema ----------
const signalCommand = {
  name: 'signal',
  description: 'Create a new trade signal',
  dm_permission: false,
  default_member_permissions: null,
  options: [
    { name: 'asset', description: 'Asset (e.g., BTC, ETH)', type: 3, required: true },
    {
      name: 'direction',
      description: 'Long or Short',
      type: 3,
      required: true,
      choices: [
        { name: 'Long', value: 'Long' },
        { name: 'Short', value: 'Short' },
      ],
    },
    { name: 'entry', description: 'Entry price', type: 3, required: true },
    { name: 'stop', description: 'Stop Loss', type: 3, required: true },
    { name: 'tp1', description: 'Take Profit 1 (optional)', type: 3, required: false },
    { name: 'tp2', description: 'Take Profit 2 (optional)', type: 3, required: false },
    { name: 'tp3', description: 'Take Profit 3 (optional)', type: 3, required: false },
    { name: 'reason', description: 'Reason (optional)', type: 3, required: false },
    {
      name: 'valid',
      description: 'Valid for re-entry?',
      type: 5,
      required: false,
    },
    {
      name: 'tag_role',
      description: 'Role to tag (optional)',
      type: 8, // ROLE
      required: false,
    },
  ],
};

// --------- Register slash commands on ready ----------
client.once(Events.ClientReady, async (c) => {
  console.log(`Ready as ${c.user.tag}`);
  console.log('Intents bitfield:', client.options.intents.bitfield); // should be 1

  try {
    const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
    await rest.put(
      Routes.applicationGuildCommands(c.user.id, GUILD_ID),
      { body: [signalCommand] },
    );
    console.log('Slash command synced');
  } catch (e) {
    console.error('Command registration failed:', e);
  }
});

// --------- Helper: permission check for owner controls ----------
function isOwnerOrTrader(interaction) {
  if (!interaction?.member) return false;
  if (interaction.user.id === OWNER_ID) return true;
  if (TRADER_ROLE_ID && interaction.member.roles?.cache?.has(TRADER_ROLE_ID)) return true;
  return false;
}

// --------- Helper: owner control buttons ----------
function ownerButtons(signalId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`jv:tp1:${signalId}`).setLabel('TP1 Hit').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`jv:tp2:${signalId}`).setLabel('TP2 Hit').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`jv:tp3:${signalId}`).setLabel('TP3 Hit').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`jv:status:active:${signalId}`).setLabel('Running (Valid)').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`jv:status:be:${signalId}`).setLabel('Running (BE)').setStyle(ButtonStyle.Primary),
  );
}
function ownerButtonsRow2(signalId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`jv:status:stopped:${signalId}`).setLabel('Stopped Out').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`jv:status:stopped_be:${signalId}`).setLabel('Stopped BE').setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`jv:status:closed:${signalId}`).setLabel('Fully Closed').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`jv:delete:${signalId}`).setLabel('Delete').setStyle(ButtonStyle.Danger),
  );
}

// --------- Helper: ensure/update summary message ----------
async function refreshSummary(guild) {
  const trades = await listActive();
  const channel = guild.channels.cache.get(CURRENT_TRADES_CHANNEL_ID);
  if (!channel) return;

  const embed = renderSummaryEmbed(trades, `${BRAND_NAME} Current Active Trades`);
  const summaryId = await getSummaryMessageId();

  if (summaryId) {
    try {
      const msg = await channel.messages.fetch(summaryId);
      await msg.edit({ embeds: [embed] });
      return;
    } catch {
      // fall through to re-create
    }
  }
  const newMsg = await channel.send({ embeds: [embed] });
  await setSummaryMessageId(newMsg.id);
}

// --------- Interaction handling ----------
client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'signal') {
      await interaction.deferReply({ ephemeral: true });

      // read inputs
      const asset = (interaction.options.getString('asset') || '').toUpperCase();
      const direction = interaction.options.getString('direction');
      const entry = interaction.options.getString('entry');
      const stop = interaction.options.getString('stop');
      const tp1 = interaction.options.getString('tp1') || '';
      const tp2 = interaction.options.getString('tp2') || '';
      const tp3 = interaction.options.getString('tp3') || '';
      const reason = interaction.options.getString('reason') || '';
      const valid = interaction.options.getBoolean('valid') ?? true;
      const tagRole = interaction.options.getRole('tag_role');

      // build signal model
      const id = uuidv4();
      const signal = {
        id,
        asset,
        direction,
        entry,
        stop,
        tp1,
        tp2,
        tp3,
        reason,
        status: 'active', // default status
        valid,
        tagRoleId: tagRole?.id || null,
        authorId: interaction.user.id,
        messageId: null,
        channelId: SIGNALS_CHANNEL_ID,
      };

      // save first (so owner buttons can reference it)
      await saveSignal(signal);

      // format embed
      const embed = renderSignalEmbed(signal);

      // post in signals channel (normal send; webhook styling is handled in embeds if you prefer)
      const signalsCh = interaction.guild.channels.cache.get(SIGNALS_CHANNEL_ID);
      if (!signalsCh) throw new Error('SIGNALS_CHANNEL_ID not found');

      const content = signal.tagRoleId ? `<@&${signal.tagRoleId}>` : undefined;
      const post = await signalsCh.send({ content, embeds: [embed] });

      // create owner-only thread (prefer Private; fall back to Public)
      let thread = null;
      try {
        thread = await post.startThread({
          name: `${asset} ${direction} • owner panel`,
          type: ChannelType.PrivateThread, // requires server has private threads enabled
          invitable: false,
        });
      } catch {
        // fallback to public thread if private not allowed
        thread = await post.startThread({
          name: `${asset} ${direction} • owner panel`,
          type: ChannelType.PublicThread,
        });
      }

      // restrict who can see/use it (add the owner, then lock if private thread didn't work)
      try {
        await thread.members.add(OWNER_ID);
      } catch {}

      // send owner controls into the thread
      const ctrlMsg = await thread.send({
        content: `<@${OWNER_ID}>`,
        embeds: [
          new EmbedBuilder()
            .setColor(Colors.Blurple)
            .setTitle('Owner Controls')
            .setDescription('Only the owner/trader role can press these buttons.')
            .setFooter({ text: id }),
        ],
        components: [ownerButtons(id), ownerButtonsRow2(id)],
      });

      // remember ids
      await updateSignal(id, { messageId: post.id });
      await setOwnerPanelMessageId(id, ctrlMsg.id);

      // update Current Active Trades summary
      await refreshSummary(interaction.guild);

      await interaction.editReply('Signal posted ✅');
      return;
    }

    // ----- Buttons (owner controls) -----
    if (interaction.isButton()) {
      if (!isOwnerOrTrader(interaction)) {
        return interaction.reply({ content: 'Nope — owner only.', ephemeral: true });
      }

      const [ns, action, arg, signalId] = interaction.customId.split(':'); // e.g., jv:status:active:<id> or jv:tp1:<id>
      if (ns !== 'jv') return;

      const sig = await getSignal(signalId);
      if (!sig) {
        return interaction.reply({ content: 'Signal not found.', ephemeral: true });
      }

      let patch = {};
      if (action === 'tp1' || action === 'tp2' || action === 'tp3') {
        patch = { [action]: sig[action] ? sig[action] + ' ✅' : '✅' }; // simple mark
      } else if (action === 'status') {
        if (arg === 'active') patch = { status: 'active', valid: true };
        if (arg === 'be') patch = { status: 'running_be', valid: false };
        if (arg === 'stopped') patch = { status: 'stopped', valid: false };
        if (arg === 'stopped_be') patch = { status: 'stopped_be', valid: false };
        if (arg === 'closed') patch = { status: 'closed', valid: false };
      } else if (action === 'delete') {
        // delete original post + summary update
        try {
          const ch = interaction.guild.channels.cache.get(sig.channelId);
          const msg = await ch.messages.fetch(sig.messageId);
          await msg.delete();
        } catch (e) {
          console.warn('delete original failed:', e.message);
        }
        await deleteSignal(sig.id);
        await refreshSummary(interaction.guild);
        return interaction.reply({ content: 'Signal deleted.', ephemeral: true });
      }

      // persist & update embed
      const updated = await updateSignal(sig.id, patch);
      const ch = interaction.guild.channels.cache.get(updated.channelId);
      const msg = await ch.messages.fetch(updated.messageId);
      await msg.edit({ embeds: [renderSignalEmbed(updated)] });

      await refreshSummary(interaction.guild);
      return interaction.reply({ content: 'Updated ✅', ephemeral: true });
    }
  } catch (e) {
    console.error('Interaction handler error:', e);
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('Something went wrong.');
      } else {
        await interaction.reply({ content: 'Something went wrong.', ephemeral: true });
      }
    } catch {}
  }
});

// --------- Login ----------
(async () => {
  try {
    if (!DISCORD_TOKEN || DISCORD_TOKEN.length < 60) {
      throw new Error('DISCORD_TOKEN missing/invalid');
    }
    await client.login(DISCORD_TOKEN);
  } catch (e) {
    console.error('Login failed:', e);
  }
})();