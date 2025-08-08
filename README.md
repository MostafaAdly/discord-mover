## Discord Mover Bot

**Command**: %move

### Setup
- Create a bot at the Discord Developer Portal and copy its token.
- Enable Gateway Intents: Message Content.
- Invite the bot to your server with the Move Members permission.
- In this folder, run:
  - npm install
  - Copy token into .env (DISCORD_TOKEN=...)
  - npm start

### .env
DISCORD_TOKEN=your-bot-token-here
PREFIX=%

### Usage
- %move <to> <delay>  (uses your current voice channel as source)
- %move <from> <to> <delay>

Examples:
- %move Gaming 30s
- %move Lobby Gaming 5m

Delay accepts forms like: 45, 30s, 5m, 1h2m3s.

The bot schedules the move and then moves everyone from the source voice channel to the target after the delay.
