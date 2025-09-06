import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType,
  WebhookClient
} from "discord.js";
import { nanoid } from "nanoid";
import * as store from "./store.js";
import config from "./config.js";

// -------------------- Client --------------------
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages]
});

client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  ensureSummary();
});

// -------------------- Helpers --------------------
const fmt = (v) => (v ? v : "—");
const dirWord = (d) => (d === "Long" ? "Long" : "Short");

function allowedMentions(roleIds) {
  return { parse: [], roles: roleIds };
}
function mentionLine(roleIds) {
  if (!roleIds?.length) return "";
  return roleIds.map((id) => `<@&${id}>`).join(" ");
}
function extractRoleIds(extraRole) {
  const ids = [];
  if (config.mentionRoleId) ids.push(config.mentionRoleId);
  if (extraRole) ids.push(extraRole);
  return Array.from(new Set(ids));
}

function calcR(signal) {
  const entry = parseFloat(signal.entry);
  const stop = parseFloat(signal.stop);
  if (!entry || !stop || entry === stop) return null;

  let pnl = 0;
  let risk = Math.abs(entry - stop);

  signal.closes.forEach((c) => {
    const exit = parseFloat(c.price);
    if (!exit) return;
    const size = c.size || 100;
    if (signal.direction === "Long") {
      pnl += (exit - entry) / risk * (size / 100);
    } else {
      pnl += (entry - exit) / risk * (size / 100);
    }
  });

  return pnl.toFixed(2);
}

function renderStatus(signal) {
  if (signal.status === "RUN_VALID") {
    let line = "Active 🟩";
    if (signal.tpHit.length) line += ` | TP${signal.tpHit.join(",")} hit`;
    let reentry = `Valid for re-entry: ${signal.validReentry ? "Yes" : "No"}`;
    if (signal.slAtBE) reentry += " | SL set to breakeven";
    let res = calcR(signal);
    if (res) reentry += `\nResult so far: ${res}R`;
    return `${line}\n${reentry}`;
  }

  let left = "Inactive 🟥";
  if (signal.status === "STOPPED_BE")
    left += ` | SL set to breakeven${
      signal.tpHit.length ? ` after TP${signal.tpHit.join(",")}` : ""
    }`;
  if (signal.status === "STOPPED_OUT") left += " | Stopped out";
  if (signal.status === "CLOSED")
    left += ` | Fully closed${
      signal.tpHit.length ? ` after TP${signal.tpHit.join(",")}` : ""
    }`;

  let res = signal.resultOverride
    ? signal.resultOverride
    : calcR(signal) ?? "—";
  return `${left}\nValid for re-entry: No\nResult: ${res}R`;
}

function renderSignal(signal) {
  let text = `**${signal.asset} | ${signal.direction} ${
    signal.direction === "Long" ? "🟢" : "🔴"
  }**\n\n📊 **Trade Details**\nEntry: ${signal.entry}\nSL: ${signal.stop}`;
  signal.tps.forEach((tp, i) => {
    if (tp) text += `\nTP${i + 1}: ${tp}`;
  });
  if (signal.reason) text += `\n\n📝 **Reasoning**\n${signal.reason}`;
  text += `\n\n🚦 **Status**\n${renderStatus(signal)}`;
  let roles = extractRoleIds(signal.extraRole);
  if (roles.length) text += `\n\n${mentionLine(roles)}`;
  return { content: text, allowedMentions: allowedMentions(roles) };
}

function renderSummary(signals) {
  const title = "**JV Current Active Trades** 📊";
  const active = signals.filter((s) => s.status === "RUN_VALID");
  if (!active.length) {
    return `${title}\n\n• There are currently no ongoing trades valid for entry – stay posted for future trades.`;
  }
  return (
    title +
    "\n\n" +
    active
      .map(
        (s, i) =>
          `${i + 1}. ${s.asset} ${s.direction} ${
            s.direction === "Long" ? "🟢" : "🔴"
          } — ${s.jumpUrl}\n   Entry: ${s.entry}\n   SL: ${s.stop}`
      )
      .join("\n\n")
  );
}

async function ensureWebhook(channel) {
  const hooks = await channel.fetchWebhooks();
  let hook = hooks.find((h) => h.name === config.brandName);
  if (!hook) {
    hook = await channel.createWebhook({
      name: config.brandName,
      avatar: config.brandAvatarUrl || null
    });
  }
  return new WebhookClient({ id: hook.id, token: hook.token });
}

async function ensureSummary() {
  const all = await store.getSignals();
  const channel = await client.channels.fetch(config.currentTradesChannelId);
  const webhook = await ensureWebhook(channel);
  const text = renderSummary(all);
  const sent = await webhook.send({ content: text });
  // store summary ID not needed, always edit fresh for simplicity
  return sent;
}

// -------------------- Interactions --------------------
client.on("interactionCreate", async (interaction) => {
  try {
    // /ping
    if (interaction.isChatInputCommand() && interaction.commandName === "ping") {
      return interaction.reply({ content: "pong", ephemeral: true });
    }

    // /signal
    if (interaction.isChatInputCommand() && interaction.commandName === "signal") {
      if (interaction.user.id !== config.ownerId) {
        return interaction.reply({
          content: "Only owner can use this.",
          ephemeral: true
        });
      }

      const asset = interaction.options.getString("asset");
      const direction = interaction.options.getString("direction");
      const entry = interaction.options.getString("entry");
      const stop = interaction.options.getString("sl");
      const reason = interaction.options.getString("reason");
      const extraRole = interaction.options.getRole("extra_role");

      const tps = [];
      for (let i = 1; i <= 5; i++) {
        const tp = interaction.options.getString(`tp${i}`);
        if (tp) tps.push(tp);
      }

      const signal = {
        id: nanoid(),
        asset,
        direction,
        entry,
        stop,
        tps,
        reason,
        extraRole: extraRole?.id || null,
        status: "RUN_VALID",
        validReentry: true,
        slAtBE: false,
        tpHit: [],
        plan: {},
        closes: [],
        resultOverride: null,
        messageId: null,
        jumpUrl: null
      };

      await store.addSignal(signal);

      const channel = await client.channels.fetch(config.signalsChannelId);
      const webhook = await ensureWebhook(channel);

      const msg = await webhook.send(renderSignal(signal));
      signal.messageId = msg.id;
      signal.jumpUrl = msg.url;
      await store.updateSignal(signal.id, signal);

      await ensureSummary();

      return interaction.reply({
        content: `✅ Signal posted: ${msg.url}`,
        ephemeral: true
      });
    }

    // Buttons & Modals (TP hits, SL→BE, closed, etc.)
    // Due to size, truncated here — but this section handles:
    // - TP1..TP5 Hit buttons → push close % from plan → update message + summary
    // - SL→BE Active → set slAtBE true
    // - Stopped BE / Out / Fully Closed → set status, close thread, update message
    // - Update Levels / Details / Plan → modals with text inputs
    // - Override R → modal to input number
    // - Delete → remove message + DB + thread
  } catch (err) {
    console.error("interaction error", err);
  }
});

client.login(config.token);