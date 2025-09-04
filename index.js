import {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  ChannelType,
  PermissionFlagsBits,
} from "discord.js";
import { config } from "./config.js";
import { renderSignalEmbed } from "./embeds.js";
import {
  saveSignal,
  listActive,
  setSummaryMessageId,
  getSummaryMessageId,
} from "./store.js";

function requireEnv(name, value) {
  if (!value) {
    console.error(`Missing ${name} in environment`);
    process.exit(1);
  }
}
requireEnv("DISCORD_TOKEN", config.token);
requireEnv("APPLICATION_ID", config.appId);
requireEnv("GUILD_ID", config.guildId);
requireEnv("SIGNALS_CHANNEL_ID", config.signalsChannelId);
requireEnv("CURRENT_TRADES_CHANNEL_ID", config.currentTradesChannelId);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("signal")
      .setDescription("Create a new trade signal")
      // REQUIRED first
      .addStringOption((o) =>
        o.setName("asset").setDescription("Asset (e.g., BTC)").setRequired(true)
      )
      .addStringOption((o) =>
        o.setName("direction").setDescription("Long or Short").setRequired(true)
      )
      .addStringOption((o) =>
        o.setName("entry").setDescription("Entry price").setRequired(true)
      )
      .addStringOption((o) =>
        o.setName("stoploss").setDescription("Stop loss").setRequired(true)
      )
      // Optional after
      .addStringOption((o) => o.setName("tp1").setDescription("Take Profit 1"))
      .addStringOption((o) => o.setName("tp2").setDescription("Take Profit 2"))
      .addStringOption((o) => o.setName("tp3").setDescription("Take Profit 3"))
      .addStringOption((o) => o.setName("reasoning").setDescription("Reasoning"))
      .addStringOption((o) =>
        o.setName("status").setDescription("Status text (default: Active 🟩)")
      ),
  ].map((c) => c.toJSON());

  const rest = new REST({ version: "10" }).setToken(config.token);
  await rest.put(
    Routes.applicationGuildCommands(config.appId, config.guildId),
    { body: commands }
  );
  console.log("Slash commands registered ✅");
}

client.once("ready", () => {
  console.log(`${client.user.tag} online ✅`);
});

client.on("interactionCreate", async (i) => {
  if (!i.isChatInputCommand()) return;
  if (i.commandName !== "signal") return;

  try {
    await i.deferReply({ ephemeral: true }); // prevents “did not respond”

    // Read options
    const data = {
      asset: i.options.getString("asset"),
      direction: i.options.getString("direction"),
      entry: i.options.getString("entry"),
      stopLoss: i.options.getString("stoploss"),
      tp1: i.options.getString("tp1"),
      tp2: i.options.getString("tp2"),
      tp3: i.options.getString("tp3"),
      reasoning: i.options.getString("reasoning"),
      status: i.options.getString("status") || "Active 🟩",
    };

    const embed = renderSignalEmbed(data);

    // Target channels
    const guild = await client.guilds.fetch(config.guildId);
    const signalsChannel = await guild.channels.fetch(config.signalsChannelId);
    const summaryChannel = await guild.channels.fetch(
      config.currentTradesChannelId
    );

    // Send message (webhook if allowed)
    let msg;
    if (config.useWebhook) {
      // Needs ManageWebhooks on the channel
      let hook =
        (await signalsChannel.fetchWebhooks()).find(
          (w) => w.owner?.id === client.user.id
        ) || null;

      if (!hook) {
        try {
          hook = await signalsChannel.createWebhook({
            name: config.brandName,
            avatar: config.brandAvatarUrl,
          });
        } catch {
          // Fallback if no permission to create
        }
      }
      if (hook) {
        msg = await hook.send({
          username: config.brandName,
          avatarURL: config.brandAvatarUrl,
          embeds: [embed],
          allowedMentions: { parse: [] },
        });
      }
    }

    if (!msg) {
      // fallback: normal bot message
      msg = await signalsChannel.send({ embeds: [embed] });
    }

    // Try to create a private thread for owner controls
    try {
      const t = await msg.startThread({
        name: `${data.asset.toUpperCase()} ${data.direction} • controls`,
        autoArchiveDuration: 1440,
        type: ChannelType.PrivateThread,
      });
      if (config.ownerId) {
        await t.members.add(config.ownerId).catch(() => {});
      }
    } catch {
      // ignore if thread creation not permitted
    }

    // Save + update summary
    await saveSignal({
      id: msg.id,
      channelId: msg.channelId,
      url: msg.url,
      ...data,
    });

    const active = await listActive();
    const summaryText =
      active.length === 0
        ? "📈 **JV Current Active Trades**\n• There are currently no ongoing trades."
        : [
            "📈 **JV Current Active Trades**",
            ...active.map(
              (s, idx) =>
                `${idx + 1}. **${s.asset.toUpperCase()} ${/long/i.test(s.direction) ? "🟩" : "🔴"}** — [jump](${s.url})\n   Entry: ${s.entry}\n   Stop Loss: ${s.stopLoss}`
            ),
          ].join("\n");

    let summaryMessageId = await getSummaryMessageId();
    try {
      if (summaryMessageId) {
        const m = await summaryChannel.messages.fetch(summaryMessageId);
        await m.edit({ content: summaryText });
      } else {
        const m = await summaryChannel.send({ content: summaryText });
        summaryMessageId = m.id;
        await setSummaryMessageId(summaryMessageId);
      }
    } catch {
      const m = await summaryChannel.send({ content: summaryText });
      await setSummaryMessageId(m.id);
    }

    await i.editReply({
      content: `✅ Signal posted: ${msg.url}`,
    });
  } catch (err) {
    console.error(err);
    if (i.deferred || i.replied) {
      await i.editReply("❌ Something went wrong creating that signal.");
    } else {
      await i.reply({ content: "❌ Error.", ephemeral: true });
    }
  }
});

(async () => {
  await registerCommands();
  await client.login(config.token);
})();
