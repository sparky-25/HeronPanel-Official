# HeronPanel

HeronPanel is now a backend-backed game server control panel prototype. It uses your supplied logo as the app logo/favicon and `bg.mp4` as the live background.

## Run

```bash
node server.mjs
```

Open:

```text
http://127.0.0.1:4173
```

Main panel file:

```text
panel.html
```

Do not open `panel.html` directly from the filesystem. The panel needs the Node backend for real API actions.

## Real Backend Pieces

- REST API under `/api/*`
- Persistent database at `data/panel-state.json`
- Per-server folders under `data/servers/<server-id>`
- Backup snapshots under `data/backups/<server-id>/<backup-id>`
- Local managed process start, stop, restart and console command input
- File manager with read, create/edit, folder create and delete actions
- Server resources, MOTD and Minecraft option editing from the panel
- Aternos-style server identity editor with custom MOTD, icon URL and PNG upload
- Uploaded PNG icons are written as each server's `server-icon.png`
- Port, database, schedule and subuser management from the panel
- Plugin installer writes to each server's `plugins` folder
- Mod installer writes to each server's `mods` folder
- Plugin and mod catalog cards show module icons
- Online search supports Modrinth and Spiget for Paper, Bukkit, Spigot, Fabric, Forge, NeoForge and related content
- Online install downloads available `.jar` files into the selected server's `plugins` or `mods` folder
- Player add/remove and moderation actions update backend state plus generated `whitelist.json`, `ops.json`, and `banned-players.json`
- Admin settings persist panel name, colors, coin rules, limits, MOTD and adapters

## Adapter Model

The local adapter works immediately through Node and the filesystem. The other adapters are exposed in the UI so you can connect real credentials/API handlers later:

- Pterodactyl: map to Client API power, console, files, backups, databases, schedules, allocations and subusers.
- VPS: map to SSH, Docker, SFTP or Wings-compatible nodes.
- GitHub: map to Actions, repository files and release backups.
- Codesandbox: map to workspace/container APIs.

## Startup Command

New local servers use a managed Node runtime by default:

```text
node "<project>/runtimes/minecraft-local-server.mjs" "{{SERVER_ID}}" "{{SERVER_NAME}}"
```

When you add a real Minecraft server jar, replace `startup.command` in `data/panel-state.json` with your real command, for example:

```text
java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar server.jar nogui
```

Then put the jar in the server folder and use Start from the panel.

## Research Notes

The UI structure follows two real-world panels:

- Pterodactyl-style modules: power, console, files, databases, schedules, network allocations, subusers, backups and startup configuration.
- Aternos-style flow: simple server start/stop, options, players/whitelist, plugin/mod browser, backups and shared access permissions.
