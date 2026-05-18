# HeronPanel Official

HeronPanel - The free game server control panel for users, networks, and game service providers.

HeronPanel is a game server management panel with a Node.js backend, real server folders, one-click game templates, Paper version selection, live console, file manager, plugin/mod installer, player management, coins system, marketplace, optimizer tools, smart backups, and admin controls.

## Features

- Real Node.js backend
- Login and register system
- Admin and normal user accounts
- Coins system
- One-click game templates for Minecraft, Rust, CS2, Palworld, Node.js bots, Python bots, and Discord bots
- Create servers from the dashboard
- Marketplace server limit upgrade
- Marketplace items for themes, plugin bundles, startup templates, and server packs
- Real Paper `server.jar` download and startup
- Paper version selector from `1.19` to latest
- Live console output from the running server process
- Console search, error highlighting, command suggestions, and command macros
- Start, stop, and restart controls
- Send console commands from the panel
- File manager
- File editor
- File and folder upload
- ZIP browser and extractor
- Plugin installer
- Mod installer
- Drag and drop plugin/mod uploads
- Enable, disable, and update-check installed plugins/mods
- Online plugin/mod search with Modrinth and Spiget
- AI server optimizer with log/resource/plugin suggestions
- Player management
- OP, whitelist, kick, ban, and remove actions
- Custom server icon
- Custom MOTD
- Network port management
- Team roles with granular permissions
- Smart restore point backups
- DDoS-style traffic analytics dashboard
- Node auto-healing with crash restart queue
- Databases, schedules, users, backups, and startup settings
- Premium black and white panel theme

## Requirements

Install these before running HeronPanel:

- Node.js 18 or newer
- Java 17 or Java 21
- Git
- Internet connection for the first Paper server download
- SteamCMD for real Rust, CS2, or Palworld binaries
- Python 3 for Python bot templates

Latest Paper versions usually require Java 21. Older Paper versions such as 1.19 usually work with Java 17.

## Local Installation

```bash
git clone https://github.com/sparky-25/HeronPanel-Official.git HeronPanel
cd HeronPanel
node server.mjs
```

Open:

```txt
http://127.0.0.1:4173
```

## Default Admin Login

```txt
Username: Admin25@GET
Email: admin88@gmail.com
Password: admin@#1238A821
Backup Password: adminbackup001@#
```

Change the admin password before public hosting.

## Run On Real VPS

A real VPS is recommended for public Minecraft hosting.

### Ubuntu / Debian VPS

Install requirements:

```bash
sudo apt update
sudo apt install -y git nodejs npm openjdk-21-jdk
```

Clone HeronPanel:

```bash
git clone https://github.com/sparky-25/HeronPanel-Official.git HeronPanel
cd HeronPanel
```

Run the panel:

```bash
HOST=0.0.0.0 PORT=4173 node server.mjs
```

Open firewall ports:

```bash
sudo ufw allow 4173/tcp
sudo ufw allow 25565/tcp
```

Panel URL:

```txt
http://YOUR_VPS_IP:4173
```

Minecraft server address:

```txt
YOUR_VPS_IP:25565
```

### Keep HeronPanel Running With PM2

Install PM2:

```bash
sudo npm install -g pm2
```

Start HeronPanel:

```bash
HOST=0.0.0.0 PORT=4173 pm2 start server.mjs --name HeronPanel
```

Save PM2 process list:

```bash
pm2 save
pm2 startup
```

View logs:

```bash
pm2 logs HeronPanel
```

Restart:

```bash
pm2 restart HeronPanel
```

Stop:

```bash
pm2 stop HeronPanel
```

## Run On GitHub Codespaces

GitHub Codespaces is good for testing HeronPanel in the browser. It is not recommended for permanent public Minecraft hosting.

### Create A Codespace

1. Open your GitHub repository.
2. Click the green `Code` button.
3. Open the `Codespaces` tab.
4. Click `Create codespace on main`.
5. Wait for the browser VS Code editor to open.

### Install Java If Needed

Check versions:

```bash
node -v
java -version
```

If Java is missing:

```bash
sudo apt update
sudo apt install -y openjdk-21-jdk
```

### Run HeronPanel

```bash
HOST=0.0.0.0 PORT=4173 node server.mjs
```

### Open The Panel

1. Go to the `Ports` tab.
2. Find port `4173`.
3. Click `Open in Browser`.

The panel will open using a GitHub Codespaces preview URL.

## Run On CodeSandbox

CodeSandbox is good for testing the panel UI and backend. It is not recommended for permanent public Minecraft hosting.

### Import The Repository

1. Open CodeSandbox.
2. Click `Import GitHub project` or `Import repository`.
3. Paste:

```txt
https://github.com/sparky-25/HeronPanel-Official
```

4. Create or open the Devbox.
5. Open the terminal.

### Check Runtime

```bash
node -v
java -version
```

If Java is not installed, use a Devbox or Docker environment that includes Java 21.

### Run HeronPanel

```bash
HOST=0.0.0.0 PORT=4173 node server.mjs
```

### Open The Panel

Open the forwarded/preview port:

```txt
4173
```

CodeSandbox will give you a preview URL for the panel.

## Run From GitHub Repository

GitHub itself does not run Minecraft servers directly. You can use GitHub in these ways:

- Store HeronPanel source code
- Clone HeronPanel to a VPS
- Run HeronPanel in GitHub Codespaces
- Use GitHub Actions only for testing/building, not live Minecraft hosting

To run from GitHub on any machine:

```bash
git clone https://github.com/sparky-25/HeronPanel-Official.git HeronPanel
cd HeronPanel
node server.mjs
```

For cloud/VPS:

```bash
HOST=0.0.0.0 PORT=4173 node server.mjs
```

## Domain And IP Setup

HeronPanel includes a helper script for website domains and Minecraft IP setup:

```bash
bash domain-ip.sh
```

The script gives these options:

- `Minecraft IP Setup`
- `Website Custom Domain Setup`
- `Check installed tools`

For the panel website, use a Cloudflare Tunnel public hostname pointing to:

```txt
http://127.0.0.1:4173
```

For Docker tunnel setup, paste your Cloudflare Tunnel token into the script. It prints a Docker command and creates:

```txt
docker-compose.cloudflared.yml
```

Then run:

```bash
docker compose -f docker-compose.cloudflared.yml up -d
```

For a normal Minecraft public IP, use a real VPS with DNS-only Cloudflare records:

```txt
A record: play.example.com -> YOUR_VPS_IP
SRV: _minecraft._tcp.play.example.com -> play.example.com:25565
```

Cloudflare Tunnel can proxy TCP, but normal Minecraft players usually need a public TCP address or a Cloudflare Access TCP client setup.

## Create A Server

1. Open HeronPanel.
2. Login or register.
3. Click `Create server`.
4. Select Paper version.
5. Choose RAM, CPU, disk, provider, and region.
6. Click create.
7. Open the server.
8. Click `Start`.

HeronPanel creates the server folder here:

```txt
data/servers/<server-id>/
```

On first start, HeronPanel downloads the selected Paper version as:

```txt
data/servers/<server-id>/server.jar
```

## Startup Command

HeronPanel uses this command for Paper servers:

```bash
java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar server.jar nogui
```

`{{SERVER_MEMORY}}` is replaced with the selected server RAM in MB.

Example:

```bash
java -Xms128M -Xmx4096M -jar server.jar nogui
```

## Paper Versions

HeronPanel supports Paper versions from:

```txt
1.19 to latest
```

The version selector is available in:

- Create server modal
- Startup tab

If you change the Paper version, HeronPanel downloads the selected version on the next server start.

## Project Structure

```txt
HeronPanel/
|-- index.html
|-- panel.html
|-- marketplace.html
|-- app.js
|-- styles.css
|-- server.mjs
|-- assets/
|-- data/
|   |-- panel-state.json
|   |-- servers/
|   `-- backups/
`-- runtimes/
```

## Important Files

```txt
server.mjs              Backend server and REST API
index.html              Main dashboard
panel.html              Server control panel
marketplace.html        Marketplace page
app.js                  Frontend logic
styles.css              Theme and layout
data/panel-state.json   Saved panel data
data/servers/           Server folders
data/backups/           Backup folders
```

## Important Notes

Do not open `index.html` or `panel.html` directly from the filesystem.

Always run:

```bash
node server.mjs
```

Then open:

```txt
http://127.0.0.1:4173
```

For VPS, CodeSandbox, or Codespaces, use:

```bash
HOST=0.0.0.0 PORT=4173 node server.mjs
```

For real public Minecraft hosting, use a VPS. CodeSandbox and GitHub Codespaces are mainly for development/testing because Minecraft needs a stable TCP port like `25565`.

## License

HeronPanel Official is provided as a free game server control panel project.
