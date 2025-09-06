import { REST, Routes, SlashCommandBuilder } from "discord.js";
import config from "./config.js";

const commands = [
  new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Ping test"),

  new SlashCommandBuilder()
    .setName("signal")
    .setDescription("Create a new trade signal (owner only)")
    .addStringOption((o) =>
      o
        .setName("asset")
        .setDescription("Asset")
        .setRequired(true)
        .addChoices(
          { name: "BTC", value: "BTC" },
          { name: "ETH", value: "ETH" },
          { name: "SOL", value: "SOL" },
          { name: "Other", value: "OTHER" }
        )
    )
    .addStringOption((o) =>
      o.setName("direction").setDescription("Long/Short").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("entry").setDescription("Entry price").setRequired(true)
    )
    .addStringOption((o) =>
      o.setName("sl").setDescription("Stop Loss").setRequired(true)
    )
    .addStringOption((o) => o.setName("tp1").setDescription("TP1 (optional)"))
    .addStringOption((o) => o.setName("tp2").setDescription("TP2 (optional)"))
    .addStringOption((o) => o.setName("tp3").setDescription("TP3 (optional)"))
    .addStringOption((o) => o.setName("tp4").setDescription("TP4 (optional)"))
    .addStringOption((o) => o.setName("tp5").setDescription("TP5 (optional)"))
    .addStringOption((o) => o.setName("reason").setDescription("Reason (optional, multiline)"))
    .addRoleOption((o) =>
      o.setName("extra_role").setDescription("Extra role to tag")
    )
].map((c) => c.toJSON());

const rest = new REST({ version: "10" }).setToken(config.token);

async function main() {
  try {
    console.log("Registering slash commands...");
    await rest.put(
      Routes.applicationGuildCommands(config.appId, config.guildId),
      { body: commands }
    );
    console.log("✅ Commands registered");
  } catch (err) {
    console.error("Failed to register commands:", err);
    process.exit(1);
  }
}

main();