require('dotenv').config();
const { Client, GatewayIntentBits, ChannelType, PermissionsBitField } = require('discord.js');

const PREFIX = process.env.PREFIX || '%';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

function parseDelayToMs(input) {
  if (!input) return null;
  const trimmed = String(input).trim().toLowerCase();
  // If it's a simple integer, treat as seconds
  if (/^\d+$/.test(trimmed)) {
    return Number(trimmed) * 1000;
  }
  // Support 1h2m3s, 5m, 30s, 2h, etc.
  const pattern = /(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?/i;
  const match = trimmed.match(pattern);
  if (!match) return null;
  const hours = Number(match[1] || 0);
  const minutes = Number(match[2] || 0);
  const seconds = Number(match[3] || 0);
  const ms = (hours * 3600 + minutes * 60 + seconds) * 1000;
  return ms > 0 ? ms : null;
}

function formatMs(ms) {
  const totalSeconds = Math.round(ms / 1000);
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s || parts.length === 0) parts.push(`${s}s`);
  return parts.join(' ');
}

function isVoiceChannel(channel) {
  if (!channel) return false;
  if (typeof channel.isVoiceBased === 'function') return channel.isVoiceBased();
  return channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice;
}

function resolveVoiceChannel(guild, arg) {
  if (!guild || !arg) return null;
  const raw = String(arg).replace(/[<#>]/g, '').trim();
  // Try ID first (covers mentions like <#id>)
  let channel = guild.channels.cache.get(raw);
  if (channel && isVoiceChannel(channel)) return channel;
  // Try by name (case-insensitive, exact match)
  const lower = String(arg).toLowerCase();
  channel = guild.channels.cache.find((c) => isVoiceChannel(c) && c.name.toLowerCase() === lower);
  if (channel) return channel;
  return null;
}

function tokenizeArgs(input) {
  const tokens = [];
  const regex = /"([^"]+)"|'([^']+)'|(<#\d+>)|(\S+)/g;
  let match;
  while ((match = regex.exec(String(input)))) {
    tokens.push(match[1] ?? match[2] ?? match[3] ?? match[4]);
  }
  return tokens;
}

async function moveMembers(fromChannel, toChannel) {
  const members = Array.from(fromChannel.members.values());
  for (const [index, member] of members.entries()) {
    try {
      await member.voice.setChannel(toChannel, 'Scheduled move command');
      // small delay to avoid rate limits if many members
      if (index % 5 === 0) {
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch (err) {
      // Continue moving remaining members even if some fail
      console.error(`Failed to move ${member.user.tag}:`, err?.message || err);
    }
  }
}

client.on('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  try {
    if (!message.guild) return; // ignore DMs
    if (message.author.bot) return; // ignore bots
    if (!message.content.startsWith(PREFIX)) return;

    const afterPrefix = message.content.slice(PREFIX.length).trim();
    const [commandToken, ...rawArgs] = tokenizeArgs(afterPrefix);
    const commandLower = (commandToken || '').toLowerCase();
    if (commandLower !== 'move' && commandLower !== 'afk') return;

    const needsMoveMembersPermission = PermissionsBitField.Flags.MoveMembers;
    const me = message.guild.members.me || (await message.guild.members.fetch(client.user.id));
    if (!me.permissions.has(needsMoveMembersPermission)) {
      await message.reply('I need the "Move Members" permission to do that.');
      return;
    }

    if (commandLower === 'move') {
      // Usage patterns:
      // %move <to> <delay>
      // %move <from> <to> <delay>
      // If <from> omitted, use author's current voice channel

      let fromArg;
      let toArg;
      let delayArg;

      if (rawArgs.length === 3) {
        [fromArg, toArg, delayArg] = rawArgs;
      } else if (rawArgs.length === 2) {
        [toArg, delayArg] = rawArgs;
      } else {
        await message.reply(
          `Usage:\n` +
            `- ${PREFIX}move <to> <delay>  (uses your current voice channel as the source)\n` +
            `- ${PREFIX}move <from> <to> <delay>\n` +
            `Tips: Use mentions <#id>, IDs, or quotes for names with spaces, e.g. "Team Meeting"\n` +
            `Examples: ${PREFIX}move <#123> 10m | ${PREFIX}move "Lobby A" "Gaming B" 30s`
        );
        return;
      }

      const delayMs = parseDelayToMs(delayArg);
      if (!delayMs) {
        await message.reply('Please provide a valid delay (e.g., 30s, 5m, 1h, or seconds like 120).');
        return;
      }

      // Resolve channels
      let fromChannel = resolveVoiceChannel(message.guild, fromArg);
      const toChannel = resolveVoiceChannel(message.guild, toArg);

      if (!toChannel) {
        await message.reply('Could not resolve the target voice channel. Mention it, use its ID, or exact name.');
        return;
      }

      if (!fromChannel) {
        const authorVoice = message.member?.voice?.channel || null;
        if (!authorVoice) {
          await message.reply('Join a voice channel or specify the source channel explicitly.');
          return;
        }
        fromChannel = authorVoice;
      }

      if (!isVoiceChannel(fromChannel) || !isVoiceChannel(toChannel)) {
        await message.reply('Both source and target must be voice channels.');
        return;
      }

      if (fromChannel.id === toChannel.id) {
        await message.reply('Source and target channels are the same.');
        return;
      }

      const fromCount = fromChannel.members.size;
      await message.reply(
        `Scheduled: moving ${fromCount} member(s) from "${fromChannel.name}" to "${toChannel.name}" in ${formatMs(delayMs)}.`
      );

      setTimeout(async () => {
        try {
          await moveMembers(fromChannel, toChannel);
          await message.channel.send(`Move complete: "${fromChannel.name}" → "${toChannel.name}".`);
        } catch (err) {
          console.error('Scheduled move failed:', err);
          await message.channel.send('Move failed. Check my permissions and try again.');
        }
      }, delayMs);
      return;
    }

    // afk command
    if (commandLower === 'afk') {
      if (rawArgs.length !== 1) {
        await message.reply(
          `Usage:\n` +
            `- ${PREFIX}afk <delay>  (moves everyone from your current voice channel to the server AFK channel)\n` +
            `Examples: ${PREFIX}afk 30s | ${PREFIX}afk 5m`
        );
        return;
      }

      const [delayArgAfk] = rawArgs;
      const delayMs = parseDelayToMs(delayArgAfk);
      if (!delayMs) {
        await message.reply('Please provide a valid delay (e.g., 30s, 5m, 1h, or seconds like 120).');
        return;
      }

      const fromChannel = message.member?.voice?.channel || null;
      if (!fromChannel || !isVoiceChannel(fromChannel)) {
        await message.reply('Join a voice channel to use this command.');
        return;
      }

      const guild = message.guild;
      const afkChannel = guild.afkChannel || (guild.afkChannelId ? guild.channels.cache.get(guild.afkChannelId) : null);
      if (!afkChannel || !isVoiceChannel(afkChannel)) {
        await message.reply('This server has no AFK channel configured.');
        return;
      }

      if (fromChannel.id === afkChannel.id) {
        await message.reply('You are already in the AFK channel.');
        return;
      }

      const fromCount = fromChannel.members.size;
      await message.reply(
        `Scheduled: moving ${fromCount} member(s) from "${fromChannel.name}" to AFK "${afkChannel.name}" in ${formatMs(delayMs)}.`
      );

      setTimeout(async () => {
        try {
          await moveMembers(fromChannel, afkChannel);
          await message.channel.send(`Move to AFK complete: "${fromChannel.name}" → "${afkChannel.name}".`);
        } catch (err) {
          console.error('Scheduled AFK move failed:', err);
          await message.channel.send('AFK move failed. Check my permissions and try again.');
        }
      }, delayMs);
      return;
    }
  } catch (error) {
    console.error('Error handling message:', error);
  }
});

const token = process.env.DISCORD_TOKEN;
if (!token) {
  console.error('Missing DISCORD_TOKEN in environment.');
  process.exit(1);
}

client.login(token);


