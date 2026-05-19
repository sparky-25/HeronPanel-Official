import { createReadStream, existsSync, statSync } from "node:fs";
import {
  copyFile,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { dirname, extname, isAbsolute, join, normalize, relative } from "node:path";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL(".", import.meta.url));
const dataDir = join(root, "data");
const serverRoot = join(dataDir, "servers");
const backupRoot = join(dataDir, "backups");
const statePath = join(dataDir, "panel-state.json");
const port = Number(process.env.PORT || 4173);
const host = process.env.HOST || "0.0.0.0";
const runtimeCommand = "java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar server.jar nogui";
const paperApiBase = "https://fill.papermc.io/v3/projects/paper";
const paperLegacyApiBase = "https://api.papermc.io/v2/projects/paper";
const velocityApiBase = "https://api.papermc.io/v2/projects/velocity";
const purpurApiBase = "https://api.purpurmc.org/v2/purpur";
const paperUserAgent = "HeronPanel/1.0 (support@heronpanel.local)";
const renewalDurationMs = 24 * 60 * 60 * 1000;
const renewalBonusMs = 45 * 60 * 1000;
const renewalAds = [
  "https://windowthrilling.com/dxhtrfx4k?key=7328a3ab6644caef163f57846d223539",
  "https://windowthrilling.com/ixk8gxw2b?key=0b42b1476b490bce9e7e3c892de9b4c6",
  "https://windowthrilling.com/v0av5ep6h?key=348f881f25d4b68be4bef5ad5e650dd2"
];
const paperVersionFallback = [
  "1.21.11",
  "1.21.10",
  "1.21.9",
  "1.21.8",
  "1.21.7",
  "1.21.6",
  "1.21.5",
  "1.21.4",
  "1.21.3",
  "1.21.1",
  "1.21",
  "1.20.6",
  "1.20.4",
  "1.20.2",
  "1.20.1",
  "1.20",
  "1.19.4",
  "1.19.3",
  "1.19.2",
  "1.19.1",
  "1.19",
  "1.18.2",
  "1.17.1",
  "1.16.5",
  "1.15.2",
  "1.14.4",
  "1.13.2",
  "1.12.2",
  "1.11.2",
  "1.10.2",
  "1.9.4",
  "1.8.8"
];
const processes = new Map();
const expectedStops = new Set();
const sessions = new Map();
const adminSeed = {
  id: "usr-admin",
  username: "Admin25@GET",
  email: "admin88@gmail.com",
  password: "admin@#1238A821",
  backupPassword: "adminbackup001@#",
  role: "admin"
};

const types = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".ico": "image/x-icon"
};

const pluginCatalog = [
  {
    id: "pl-luckperms",
    name: "LuckPerms",
    version: "5.4",
    description: "Permissions and rank management.",
    icon: "shield",
    sourceUrl: ""
  },
  {
    id: "pl-essentials",
    name: "EssentialsX",
    version: "2.21",
    description: "Homes, warps, economy, chat and moderation commands.",
    icon: "terminal",
    sourceUrl: ""
  },
  {
    id: "pl-worldguard",
    name: "WorldGuard",
    version: "7.0",
    description: "Regions, flags and grief protection.",
    icon: "settings",
    sourceUrl: ""
  }
];

const modCatalog = [
  {
    id: "mod-sodium",
    name: "Sodium",
    version: "0.6",
    description: "Fabric performance optimization.",
    icon: "activity",
    sourceUrl: ""
  },
  {
    id: "mod-create",
    name: "Create",
    version: "0.5",
    description: "Mechanical automation gameplay mod.",
    icon: "code",
    sourceUrl: ""
  },
  {
    id: "mod-jei",
    name: "Just Enough Items",
    version: "17.3",
    description: "Recipe browser for modded servers.",
    icon: "package",
    sourceUrl: ""
  }
];

const gameTemplates = [
  {
    id: "minecraft-paper",
    name: "Minecraft Java Paper",
    category: "Minecraft",
    runtime: "Java 21",
    image: "paper-java-runtime",
    command: runtimeCommand,
    folders: ["plugins", "world", "logs", "config"],
    description: "Downloads a real Paper server.jar on first start."
  },
  {
    id: "minecraft-purpur",
    name: "Purpur",
    category: "Minecraft",
    runtime: "Java 21",
    image: "purpur-java-runtime",
    command: runtimeCommand,
    folders: ["plugins", "world", "logs", "config"],
    description: "Downloads a real Purpur server.jar on first start."
  },
  {
    id: "minecraft-forge",
    name: "Forge Modded",
    category: "Minecraft",
    runtime: "Java 21",
    image: "forge-java-runtime",
    command: "sh run.sh nogui",
    folders: ["mods", "world", "logs", "config"],
    description: "Modded Minecraft layout with mods folder and Java startup."
  },
  {
    id: "minecraft-fabric",
    name: "Fabric Modded",
    category: "Minecraft",
    runtime: "Java 21",
    image: "fabric-java-runtime",
    command: "java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar server.jar nogui",
    folders: ["mods", "world", "logs", "config"],
    description: "Fabric-style modded Minecraft layout."
  },
  {
    id: "velocity",
    name: "Velocity Proxy",
    category: "Minecraft",
    runtime: "Java 21",
    image: "velocity-java-runtime",
    command: "java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar server.jar",
    folders: ["plugins", "logs", "config"],
    description: "Downloads a real Velocity proxy jar on first start."
  },
  {
    id: "bungee",
    name: "BungeeCord",
    category: "Minecraft",
    runtime: "Java 17+",
    image: "bungee-java-runtime",
    command: "java -Xms128M -Xmx{{SERVER_MEMORY}}M -jar server.jar",
    folders: ["plugins", "logs", "config"],
    description: "Downloads a real BungeeCord proxy jar on first start."
  },
  {
    id: "node-bot",
    name: "Node.js Bot",
    category: "Bots",
    runtime: "Node.js 18+",
    image: "node-runtime",
    command: "node bot.js",
    folders: ["src", "logs"],
    description: "Ready-to-run Node.js bot starter."
  },
  {
    id: "python-bot",
    name: "Python Bot",
    category: "Bots",
    runtime: "Python 3",
    image: "python-runtime",
    command: "python bot.py",
    folders: ["src", "logs"],
    description: "Ready-to-run Python bot starter."
  },
  {
    id: "discord-bot",
    name: "Discord Bot",
    category: "Bots",
    runtime: "Node.js 18+",
    image: "node-runtime",
    command: "node discord-bot.js",
    folders: ["src", "logs"],
    description: "Discord bot starter with .env example."
  }
];

const defaultCommandMacros = [
  { id: "macro-say", name: "Say hello", command: "say Hello from HeronPanel" },
  { id: "macro-save", name: "Save world", command: "save-all" },
  { id: "macro-list", name: "List players", command: "list" }
];

const serverPresets = {
  "lifesteal-smp": {
    name: "Lifesteal SMP",
    motd: "Lifesteal SMP powered by HeronPanel",
    gamemode: "survival",
    difficulty: "hard",
    pvp: true,
    slots: 80,
    plugins: ["LuckPerms", "EssentialsX"]
  },
  boxpvp: {
    name: "BoxPvP",
    motd: "BoxPvP arena online",
    gamemode: "survival",
    difficulty: "normal",
    pvp: true,
    slots: 120,
    plugins: ["LuckPerms", "WorldGuard"]
  },
  skyblock: {
    name: "Skyblock",
    motd: "Skyblock island network",
    gamemode: "survival",
    difficulty: "normal",
    pvp: false,
    slots: 60,
    plugins: ["LuckPerms", "EssentialsX"]
  },
  smp: {
    name: "SMP Mode",
    motd: "SMP survival server",
    gamemode: "survival",
    difficulty: "normal",
    pvp: true,
    slots: 60,
    plugins: ["LuckPerms"]
  },
  minigame: {
    name: "Minigame Mode",
    motd: "Fast minigame lobby",
    gamemode: "adventure",
    difficulty: "easy",
    pvp: false,
    slots: 100,
    plugins: ["LuckPerms", "WorldGuard"]
  },
  "survival-plus": {
    name: "Survival Plus",
    motd: "Survival Plus with economy, claims, and ranks",
    gamemode: "survival",
    difficulty: "normal",
    pvp: true,
    slots: 100,
    plugins: ["LuckPerms", "EssentialsX", "WorldGuard"]
  }
};

const performanceModes = {
  pvp: {
    viewDistance: 6,
    simulationDistance: 4,
    pvp: true,
    monsters: false,
    animals: false,
    note: "PvP Mode applied: lower view distance and reduced mob load."
  },
  smp: {
    viewDistance: 8,
    simulationDistance: 6,
    pvp: true,
    monsters: true,
    animals: true,
    note: "SMP Mode applied: balanced entities and exploration."
  },
  minigame: {
    viewDistance: 5,
    simulationDistance: 3,
    pvp: false,
    monsters: false,
    animals: false,
    note: "Minigame Mode applied: compact fast lobby settings."
  }
};

const marketplaceItems = [
  { id: "theme-nebula", name: "Nebula UI Pack", type: "theme", price: 250, description: "Glass panels, animated stats, and premium spacing." },
  { id: "pack-survival", name: "Survival Server Pack", type: "server-pack", price: 350, description: "Starter files and plugin suggestions for survival servers." },
  { id: "template-discord", name: "Discord Bot Template", type: "startup-template", price: 150, description: "Bot startup profile and starter files." },
  { id: "plugin-ops", name: "Ops Plugin Bundle", type: "plugin-bundle", price: 300, description: "Permissions, essentials, and moderation recommendations." }
];

const marketplaceEffects = {
  "pack-survival": {
    unlockedPreset: "survival-plus",
    activity: "Survival Plus preset unlocked."
  },
  "template-discord": {
    unlockedTemplate: "discord-bot",
    activity: "Discord Bot startup template unlocked."
  },
  "plugin-ops": {
    plugins: ["LuckPerms", "EssentialsX", "WorldGuard"],
    activity: "Ops plugin bundle unlocked in catalog."
  }
};

function defaultState() {
  return {
    coins: 125,
    clickProgress: 0,
    selectedServerId: "",
    activeDetailTab: "console",
    unlockedPresets: [],
    unlockedTemplates: [],
    settings: {
      panelName: "HeronPanel",
      serverCost: 50,
      maxServers: 10,
      clickTarget: 100,
      clickReward: 50,
      motd: "Welcome to HeronPanel. Real backend, clean control.",
      activeTheme: "premium-dark",
      providers: {
        codesandbox: true,
        github: true,
        vps: true
      }
    },
    pluginCatalog,
    modCatalog,
    marketplaceItems,
    marketplacePurchases: [],
    apiKeys: [],
    security: {
      ipBlacklist: [],
      registrationApproval: true,
      rateLimit: true,
      auditLog: []
    },
    servers: [],
    players: [],
    users: [adminUser()],
    activity: ["Backend initialized. Panel state is stored in data/panel-state.json."]
  };
}

let state = defaultState();

function nowLine(message) {
  return `[${new Date().toLocaleTimeString("en-IN", { hour12: false })}] ${message}`;
}

function hashSecret(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function adminUser() {
  return {
    id: adminSeed.id,
    username: adminSeed.username,
    email: adminSeed.email,
    role: adminSeed.role,
    passwordHash: hashSecret(adminSeed.password),
    backupPasswordHash: hashSecret(adminSeed.backupPassword),
    loginAliases: [adminSeed.username.toLowerCase(), adminSeed.email.toLowerCase()],
    createdAt: new Date().toISOString()
  };
}

function sanitizeUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    username: user.username,
    email: user.email,
    role: user.role || "user",
    status: user.status || "active",
    createdAt: user.createdAt
  };
}

function ensureAdminUser() {
  state.users = Array.isArray(state.users) ? state.users : [];
  const existing = state.users.find((user) => user.id === adminSeed.id || user.email === adminSeed.email || user.username === adminSeed.username);
  if (existing) {
    existing.id = adminSeed.id;
    existing.username = existing.username || adminSeed.username;
    existing.email = existing.email || adminSeed.email;
    existing.role = "admin";
    existing.passwordHash = existing.passwordHash || hashSecret(adminSeed.password);
    existing.backupPasswordHash = hashSecret(adminSeed.backupPassword);
    existing.loginAliases = Array.from(new Set([
      ...(existing.loginAliases || []),
      adminSeed.username.toLowerCase(),
      adminSeed.email.toLowerCase()
    ]));
    existing.createdAt = existing.createdAt || new Date().toISOString();
    return;
  }
  state.users.unshift(adminUser());
}

function userLoginIds(user) {
  return [
    user.username,
    user.email,
    ...(user.loginAliases || [])
  ].map((item) => String(item || "").trim().toLowerCase()).filter(Boolean);
}

function findUserByLogin(identifier) {
  const normalized = String(identifier || "").trim().toLowerCase();
  return state.users.find((user) => userLoginIds(user).includes(normalized));
}

function loginIdentityTaken(value, exceptUserId = "") {
  const normalized = String(value || "").trim().toLowerCase();
  return state.users.some((user) => user.id !== exceptUserId && userLoginIds(user).includes(normalized));
}

function verifyPassword(user, password) {
  const passwordHash = hashSecret(password || "");
  return user.passwordHash === passwordHash || user.backupPasswordHash === passwordHash;
}

function ensureUserCanLogin(user) {
  if ((user.status || "active") === "active") return;
  const error = new Error(user.status === "pending" ? "Account is pending admin approval" : "Account is suspended");
  error.status = 403;
  throw error;
}

function authenticate(request) {
  const header = request.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (token.startsWith("hp_")) {
    const key = (state.apiKeys || []).find((item) => item.hash === hashSecret(token));
    if (key) {
      key.lastUsed = new Date().toISOString();
      const user = state.users.find((item) => item.id === key.userId) || state.users.find((item) => item.id === adminSeed.id);
      if (user) return user;
    }
  }
  const userId = sessions.get(token);
  const user = state.users.find((item) => item.id === userId);
  if (!user) {
    const error = new Error("Login required");
    error.status = 401;
    throw error;
  }
  return user;
}

function isAdmin(user) {
  return user?.role === "admin";
}

function requireAdmin(user) {
  if (isAdmin(user)) return;
  const error = new Error("Admin access required");
  error.status = 403;
  throw error;
}

function uid(prefix) {
  return `${prefix}-${randomUUID().slice(0, 8)}`;
}

function slug(value) {
  return String(value || "server")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 36) || "server";
}

function versionParts(version) {
  const match = String(version || "").match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return [Number(match[1] || 0), Number(match[2] || 0), Number(match[3] || 0)];
}

function compareVersions(a, b) {
  const left = versionParts(a);
  const right = versionParts(b);
  if (!left || !right) return String(a).localeCompare(String(b));
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return String(a).localeCompare(String(b));
}

function paperVersionAllowed(version) {
  const parts = versionParts(version);
  if (!parts) return false;
  return compareVersions(version, "1.8") >= 0;
}

function normalizePaperVersion(value) {
  const version = String(value || "latest").trim();
  if (!version || version === "latest") return "latest";
  if (!paperVersionAllowed(version)) throw new Error("Minecraft version must be 1.8 or newer");
  return version;
}

function normalizeBackupLimit(value, fallback = 10) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number < 0) return fallback;
  return Math.floor(number);
}

function templateForEgg(egg = "") {
  const normalized = String(egg || "").trim().toLowerCase();
  return gameTemplates.find((template) => template.name.toLowerCase() === normalized || template.id === normalized) || gameTemplates[0];
}

async function ensureDirs() {
  await mkdir(serverRoot, { recursive: true });
  await mkdir(backupRoot, { recursive: true });
  await mkdir(join(root, "runtimes"), { recursive: true });
}

async function loadState() {
  await ensureDirs();
  if (!existsSync(statePath)) {
    state = defaultState();
    await persist();
    return;
  }

  const saved = JSON.parse((await readFile(statePath, "utf8")).replace(/^\uFEFF/, ""));
  state = mergeState(defaultState(), saved);
  const existingServers = [];
  const removedServers = [];
  for (const server of state.servers) {
    if (!existsSync(serverDir(server))) {
      removedServers.push(server);
      continue;
    }
    if (server.status === "running") server.status = "stopped";
    await ensureServerFiles(server);
    await ensureTemplateFiles(server, templateForEgg(server.egg));
    existingServers.push(server);
  }
  if (removedServers.length) {
    const existingIds = new Set(existingServers.map((server) => server.id));
    state.servers = existingServers;
    state.players = state.players.filter((player) => existingIds.has(player.serverId));
    if (!existingIds.has(state.selectedServerId)) state.selectedServerId = state.servers[0]?.id || "";
    addActivity(`Removed ${removedServers.length} orphan server record${removedServers.length === 1 ? "" : "s"} with missing folders.`);
  }
  await persist();
}

function mergeState(base, saved) {
  const merged = { ...base, ...saved };
  merged.settings = { ...base.settings, ...(saved.settings || {}) };
  merged.settings.providers = {
    ...base.settings.providers,
    ...((saved.settings && saved.settings.providers) || {})
  };
  delete merged.settings.providers.local;
  delete merged.settings.providers.pterodactyl;
  for (const key of ["primaryColor", "accentColor", "panelBackground", "animationTheme"]) {
    delete merged.settings[key];
  }
  merged.pluginCatalog = saved.pluginCatalog || base.pluginCatalog;
  merged.modCatalog = saved.modCatalog || base.modCatalog;
  merged.marketplaceItems = base.marketplaceItems;
  merged.marketplacePurchases = saved.marketplacePurchases || base.marketplacePurchases;
  merged.unlockedPresets = saved.unlockedPresets || base.unlockedPresets;
  merged.unlockedTemplates = saved.unlockedTemplates || base.unlockedTemplates;
  merged.apiKeys = saved.apiKeys || base.apiKeys;
  merged.security = {
    ...base.security,
    ...(saved.security || {}),
    auditLog: Array.isArray(saved.security?.auditLog) ? saved.security.auditLog : []
  };
  merged.servers = saved.servers || base.servers;
  merged.players = saved.players || base.players;
  merged.users = saved.users || base.users;
  merged.activity = saved.activity || base.activity;
  merged.pluginCatalog = hydrateCatalog(merged.pluginCatalog, base.pluginCatalog, "plugin");
  merged.modCatalog = hydrateCatalog(merged.modCatalog, base.modCatalog, "mod");
  merged.servers = merged.servers.map((server) => {
    const template = templateForEgg(server.egg);
    const ports = server.ports?.length ? server.ports.map(String) : [String(server.startup?.variables?.SERVER_PORT || "25565")];
    const allocation = server.allocation || `127.0.0.1:${ports[0]}`;
    const allocationPort = allocation.match(/:(\d{2,5})$/)?.[1] || ports[0];
    return {
      icon: "assets/brand-logo.png",
      ...server,
      ports,
      allocation,
      startup: {
        command: !server.startup?.command || server.startup.command.includes("minecraft-local-server.mjs") ? template.command : server.startup.command,
        image: server.startup?.image && !["local-node-runtime", "remote-node-runtime"].includes(server.startup.image) ? server.startup.image : template.image,
        variables: {
          ...(server.startup?.variables || {}),
          SERVER_ID: server.id,
          SERVER_NAME: server.name,
          SERVER_MEMORY: String((server.ram || 2) * 1024),
          SERVER_PORT: allocationPort,
          MC_VERSION: normalizePaperVersion(server.startup?.variables?.MC_VERSION || "latest")
        }
      },
      template: server.template || template.id,
      disabledPlugins: server.disabledPlugins || [],
      disabledMods: server.disabledMods || [],
      backupLimit: normalizeBackupLimit(server.backupLimit, 10),
      autoBackup: {
        hourly: server.autoBackup?.hourly !== false,
        daily: server.autoBackup?.daily !== false,
        lastHourly: server.autoBackup?.lastHourly || "",
        lastDaily: server.autoBackup?.lastDaily || ""
      },
      commandMacros: Array.isArray(server.commandMacros) && server.commandMacros.length ? server.commandMacros : defaultCommandMacros,
      permissions: server.permissions || {
        groups: [
          { name: "default", permissions: ["minecraft.command.help"] },
          { name: "moderator", permissions: ["minecraft.command.kick", "minecraft.command.ban"] },
          { name: "admin", permissions: ["*"] }
        ]
      },
      autoHeal: {
        enabled: server.autoHeal?.enabled !== false,
        restarts: Number(server.autoHeal?.restarts || 0),
        lastAction: server.autoHeal?.lastAction || "Ready"
      },
      backupTargets: {
        local: true,
        googleDrive: Boolean(server.backupTargets?.googleDrive),
        dropbox: Boolean(server.backupTargets?.dropbox)
      },
      optimizer: server.optimizer || null,
      expiresAt: server.expiresAt || new Date(Date.now() + renewalDurationMs).toISOString(),
      renewal: {
        watchedAds: Array.isArray(server.renewal?.watchedAds) ? server.renewal.watchedAds : []
      }
    };
  });
  state = merged;
  ensureAdminUser();
  return merged;
}

function hydrateCatalog(items, defaults, type) {
  return items.map((item, index) => {
    const fallback = defaults.find((entry) => entry.id === item.id) || defaults[index] || {};
    return {
      icon: type === "plugin" ? "package" : "code",
      ...fallback,
      ...item
    };
  });
}

async function persist() {
  await mkdir(dataDir, { recursive: true });
  await writeFile(statePath, JSON.stringify(state, null, 2));
}

function publicState(viewer = null) {
  const visibleServers = isAdmin(viewer)
    ? state.servers
    : viewer
      ? state.servers.filter((server) => server.owner === viewer.id || server.owner === viewer.username)
      : [];
  return {
    ...state,
    servers: visibleServers,
    players: isAdmin(viewer) ? state.players : state.players.filter((player) => visibleServers.some((server) => server.id === player.serverId)),
    apiKeys: isAdmin(viewer)
      ? state.apiKeys.map((key) => ({ id: key.id, name: key.name, prefix: key.prefix, createdAt: key.createdAt, lastUsed: key.lastUsed || "" }))
      : [],
    security: isAdmin(viewer) ? state.security : { ipBlacklist: [], registrationApproval: true, rateLimit: true, auditLog: [] },
    gameTemplates: gameTemplates.map(({ id, name, category, runtime, description }) => ({ id, name, category, runtime, description })),
    serverPresets: Object.entries(serverPresets)
      .filter(([id]) => id !== "survival-plus" || state.unlockedPresets?.includes(id) || state.marketplacePurchases?.includes("pack-survival"))
      .map(([id, preset]) => ({ id, name: preset.name })),
    performanceModes: Object.keys(performanceModes),
    marketplaceItems,
    users: isAdmin(viewer) ? state.users.map(sanitizeUser) : viewer ? [sanitizeUser(viewer)] : [],
    backend: {
      connected: true,
      storage: relative(root, statePath),
      runningProcesses: processes.size,
      mode: "node-rest-filesystem"
    }
  };
}

function addActivity(message) {
  state.activity.unshift(message);
  state.activity = state.activity.slice(0, 30);
  state.security = state.security || { auditLog: [] };
  state.security.auditLog = [
    { id: uid("audit"), at: new Date().toISOString(), message },
    ...(state.security.auditLog || [])
  ].slice(0, 80);
}

function addLog(server, message) {
  server.console.push(nowLine(message));
  server.console = server.console.slice(-120);
}

function serverExpired(server) {
  return new Date(server.expiresAt || 0).getTime() <= Date.now();
}

function ensureServerActive(server) {
  if (server.status === "suspended") throw new Error("Server is suspended. Resume it before starting.");
  if (!serverExpired(server)) return;
  server.status = "expired";
  throw new Error("Server expired. Renew it by opening all 3 ads first.");
}

function renewProgress(server) {
  const watched = new Set(server.renewal?.watchedAds || []);
  return {
    watched: [...watched],
    required: renewalAds.length,
    complete: watched.size >= renewalAds.length,
    ads: renewalAds.map((url, index) => ({ index, url, watched: watched.has(index) }))
  };
}

function addLogChunk(server, chunk, prefix = "") {
  const lines = String(chunk || "").split(/\r?\n/).map((line) => line.trimEnd()).filter(Boolean);
  for (const line of lines) addLog(server, `${prefix}${line}`);
}

function primaryPort(server) {
  const allocationPort = String(server.allocation || "").match(/:(\d{2,5})$/)?.[1];
  return allocationPort || server.ports?.[0] || server.startup?.variables?.SERVER_PORT || "25565";
}

function serverAddress(server) {
  return server.allocation || `127.0.0.1:${primaryPort(server)}`;
}

function serverDir(server) {
  return join(serverRoot, server.id);
}

async function ensureServerFiles(server) {
  const base = serverDir(server);
  await mkdir(join(base, "plugins"), { recursive: true });
  await mkdir(join(base, "mods"), { recursive: true });
  await mkdir(join(base, "world"), { recursive: true });
  await mkdir(join(base, "logs"), { recursive: true });
  await mkdir(join(base, "config"), { recursive: true });
  const props = [
    `motd=${server.motd || state.settings.motd}`,
    `server-ip=`,
    `server-port=${primaryPort(server)}`,
    `max-players=${server.options?.slots || 60}`,
    `gamemode=${server.options?.gamemode || "survival"}`,
    `difficulty=${server.options?.difficulty || "normal"}`,
    `white-list=${Boolean(server.options?.whitelist)}`,
    `pvp=${server.options?.pvp !== false}`,
    `enable-command-block=${Boolean(server.options?.commandBlocks)}`,
    `online-mode=${server.options?.cracked ? "false" : "true"}`,
    `allow-flight=${Boolean(server.options?.fly)}`,
    `spawn-monsters=${server.options?.monsters !== false}`,
    `spawn-animals=${server.options?.animals !== false}`,
    `allow-nether=${server.options?.nether !== false}`,
    `spawn-protection=${server.options?.spawnProtection || 16}`
  ].join("\n");
  await writeFile(join(base, "server.properties"), `${props}\n`);
  await writeFile(join(base, "eula.txt"), "eula=true\n");
  await writeFile(join(base, "whitelist.json"), JSON.stringify(playersFor(server.id, "whitelisted"), null, 2));
  await writeFile(join(base, "ops.json"), JSON.stringify(playersFor(server.id, "op"), null, 2));
  await writeFile(join(base, "banned-players.json"), JSON.stringify(playersFor(server.id, "banned"), null, 2));
}

function playersFor(serverId, type) {
  return state.players
    .filter((player) => player.serverId === serverId)
    .filter((player) => {
      if (type === "whitelisted") return player.whitelisted;
      if (type === "op") return ["Owner", "Operator"].includes(player.role);
      if (type === "banned") return player.status === "banned";
      return false;
    })
    .map((player) => ({ name: player.name, role: player.role, status: player.status }));
}

function applyServerPreset(server, presetId) {
  const preset = serverPresets[String(presetId || "").trim()];
  if (!preset) return;
  server.preset = presetId;
  server.motd = preset.motd || server.motd;
  server.options = {
    ...server.options,
    slots: preset.slots || server.options.slots,
    gamemode: preset.gamemode || server.options.gamemode,
    difficulty: preset.difficulty || server.options.difficulty,
    pvp: typeof preset.pvp === "boolean" ? preset.pvp : server.options.pvp
  };
  for (const plugin of preset.plugins || []) {
    if (!server.plugins.includes(plugin)) server.plugins.push(plugin);
  }
  server.console.push(nowLine(`Server preset applied: ${preset.name}.`));
}

function applyMarketplaceEffect(item) {
  const effect = marketplaceEffects[item.id];
  if (item.id === "theme-nebula") state.settings.activeTheme = "nebula";
  if (!effect) return;
  state.unlockedPresets = state.unlockedPresets || [];
  state.unlockedTemplates = state.unlockedTemplates || [];
  if (effect.unlockedPreset && !state.unlockedPresets.includes(effect.unlockedPreset)) state.unlockedPresets.push(effect.unlockedPreset);
  if (effect.unlockedTemplate && !state.unlockedTemplates.includes(effect.unlockedTemplate)) state.unlockedTemplates.push(effect.unlockedTemplate);
  if (effect.plugins) {
    for (const pluginName of effect.plugins) {
      const item = state.pluginCatalog.find((entry) => entry.name === pluginName);
      if (item) item.description = `${item.description} Included in Ops bundle.`;
    }
  }
  addActivity(effect.activity);
}

async function createServerRecord(input, spendCoins = true) {
  const id = uid("srv");
  const template = templateForEgg(input.egg);
  const name = String(input.name || "New Server").trim();
  const ram = Number(input.ram || 2);
  const cpu = Number(input.cpu || 100);
  const disk = Number(input.disk || 10);
  const backupLimit = normalizeBackupLimit(input.backupLimit, 10);
  const port = 25565 + state.servers.length;
  const paperVersion = normalizePaperVersion(input.paperVersion);
  const server = {
    id,
    name,
    egg: template.name,
    template: template.id,
    provider: input.provider || "vps",
    region: input.region || "India - Mumbai",
    runtime: input.runtime || template.runtime,
    status: "stopped",
    ram,
    cpu,
    disk,
    allocation: `127.0.0.1:${port}`,
    ports: [String(port), String(port + 1000)],
    owner: input.ownerId || "usr-admin",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + renewalDurationMs).toISOString(),
    renewal: { watchedAds: [] },
    motd: state.settings.motd,
    icon: "assets/brand-logo.png",
    plugins: [],
    mods: [],
    disabledPlugins: [],
    disabledMods: [],
    backups: [],
    backupLimit,
    autoBackup: { hourly: true, daily: true, lastHourly: "", lastDaily: "" },
    backupTargets: { local: true, googleDrive: false, dropbox: false },
    commandMacros: defaultCommandMacros.map((macro) => ({ ...macro, id: uid("macro") })),
    permissions: {
      groups: [
        { name: "default", permissions: ["minecraft.command.help"] },
        { name: "moderator", permissions: ["minecraft.command.kick", "minecraft.command.ban"] },
        { name: "admin", permissions: ["*"] }
      ]
    },
    autoHeal: { enabled: true, restarts: 0, lastAction: "Ready" },
    optimizer: null,
    databases: [
      { id: uid("db"), name: `${slug(name).replaceAll("-", "_")}_main`, user: `${slug(name).replaceAll("-", "_")}_user`, host: "localhost" }
    ],
    schedules: [
      { id: uid("sch"), name: "Daily restart", cron: "0 4 * * *", action: "restart", active: true }
    ],
    files: [],
    options: {
      slots: 60,
      gamemode: "survival",
      difficulty: "normal",
      whitelist: true,
      pvp: true,
      commandBlocks: false,
      cracked: false,
      fly: false,
      monsters: true,
      animals: true,
      nether: true,
      spawnProtection: 16,
      timezone: "Asia/Kolkata"
    },
    startup: {
      command: template.command,
      image: template.image,
      variables: {
        SERVER_ID: id,
        SERVER_NAME: name,
        SERVER_MEMORY: String(ram * 1024),
        SERVER_PORT: String(port),
        GAME_TEMPLATE: template.id,
        GAME_NAME: template.name,
        MC_VERSION: paperVersion
      }
    },
    subusers: [
      { name: "owner", role: "Full access", permissions: ["Start", "Stop", "Console", "Files", "Backups", "Players"] }
    ],
    console: [
      nowLine(`${name} filesystem created.`),
      nowLine(`Adapter selected: ${input.provider || "vps"}.`),
      nowLine(`Primary IP: 127.0.0.1:${port}`),
      nowLine(`Template installed: ${template.name}.`),
      nowLine(/minecraft|paper|purpur|fabric|forge|velocity|bungee/i.test(template.name) ? `Minecraft version selected: ${paperVersion === "latest" ? "Latest stable" : paperVersion}.` : `Startup command prepared: ${template.command}.`),
      nowLine(template.description)
    ]
  };
  applyServerPreset(server, input.preset);
  await ensureServerFiles(server);
  await ensureTemplateFiles(server, template);
  await refreshServerFileList(server);
  if (spendCoins) state.coins -= Number(state.settings.serverCost);
  return server;
}

async function ensureTemplateFiles(server, template = templateForEgg(server.egg)) {
  const base = serverDir(server);
  for (const folder of template.folders || []) {
    await mkdir(join(base, folder), { recursive: true });
  }
  const files = templateStarterFiles(server, template);
  for (const file of files) {
    const target = join(base, file.path);
    if (existsSync(target)) continue;
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file.content);
  }
}

function templateStarterFiles(server, template) {
  const commonReadme = `# ${server.name}

Template: ${template.name}
Runtime: ${template.runtime}
Port: ${primaryPort(server)}

This folder was generated by HeronPanel one-click installer.
`;
  if (template.id === "node-bot") {
    return [
      { path: "README.md", content: `${commonReadme}\nRun command: node bot.js\n` },
      { path: "package.json", content: JSON.stringify({ scripts: { start: "node bot.js" }, dependencies: {} }, null, 2) },
      { path: "bot.js", content: `console.log("HeronPanel Node.js bot started.");\nsetInterval(() => console.log("bot heartbeat", new Date().toISOString()), 15000);\n` }
    ];
  }
  if (template.id === "python-bot") {
    return [
      { path: "README.md", content: `${commonReadme}\nRun command: python bot.py\n` },
      { path: "requirements.txt", content: "" },
      { path: "bot.py", content: `import time\nprint("HeronPanel Python bot started.")\nwhile True:\n    print("bot heartbeat")\n    time.sleep(15)\n` }
    ];
  }
  if (template.id === "discord-bot") {
    return [
      { path: "README.md", content: `${commonReadme}\nAdd your token to .env, install discord.js, then run node discord-bot.js.\n` },
      { path: ".env.example", content: "DISCORD_TOKEN=put-token-here\n" },
      { path: "package.json", content: JSON.stringify({ scripts: { start: "node discord-bot.js" }, dependencies: { "discord.js": "^14.0.0" } }, null, 2) },
      { path: "discord-bot.js", content: `console.log("Discord bot template ready. Add DISCORD_TOKEN and install dependencies.");\nsetInterval(() => console.log("discord bot heartbeat"), 15000);\n` }
    ];
  }
  if (template.id === "velocity") {
    return [
      { path: "README.md", content: `${commonReadme}\nUpload velocity.jar in File Manager, then press Start.\n` },
      { path: "config/velocity.toml", content: `bind = "0.0.0.0:${primaryPort(server)}"\nmotd = "${server.motd || state.settings.motd}"\n` }
    ];
  }
  return [
    { path: "README.md", content: commonReadme }
  ];
}

async function refreshServerFileList(server) {
  const base = serverDir(server);
  server.files = await readTree(base);
}

async function listDirectory(server, targetPath = ".") {
  const cleanPath = cleanOptionalPath(targetPath);
  const fullPath = safeServerPath(server, cleanPath);
  const directoryStat = await stat(fullPath);
  if (!directoryStat.isDirectory()) throw new Error("Path is not a folder");
  const entries = await readdir(fullPath, { withFileTypes: true });
  const base = serverDir(server);
  const files = [];
  for (const entry of entries) {
    const fullEntry = join(fullPath, entry.name);
    const entryStat = await stat(fullEntry);
    const entryPath = relative(base, fullEntry).replaceAll("\\", "/");
    files.push({
      name: entry.isDirectory() ? `${entryPath}/` : entryPath,
      label: entry.name,
      type: entry.isDirectory() ? "Folder" : extname(entry.name).replace(".", "").toUpperCase() || "File",
      size: entry.isDirectory() ? "folder" : `${Math.max(1, Math.ceil(entryStat.size / 1024))} KB`,
      bytes: entryStat.size
    });
  }
  return files.sort((a, b) => {
    if (a.type === "Folder" && b.type !== "Folder") return -1;
    if (a.type !== "Folder" && b.type === "Folder") return 1;
    return a.label.localeCompare(b.label);
  });
}

async function readTree(base, dir = ".", files = []) {
  const full = join(base, dir);
  const entries = await readdir(full, { withFileTypes: true });
  for (const entry of entries) {
    const relativePath = dir === "." ? entry.name : `${dir}/${entry.name}`;
    const entryStat = await stat(join(base, relativePath));
    files.push({
      name: entry.isDirectory() ? `${relativePath}/` : relativePath,
      type: entry.isDirectory() ? "Folder" : extname(entry.name).replace(".", "").toUpperCase() || "File",
      size: entry.isDirectory() ? "folder" : `${Math.max(1, Math.ceil(entryStat.size / 1024))} KB`
    });
    if (entry.isDirectory() && files.length < 500) {
      await readTree(base, relativePath, files);
    }
  }
  return files.slice(0, 80);
}

function safeServerPath(server, targetPath = ".") {
  const base = serverDir(server);
  const fullPath = normalize(join(base, String(targetPath || ".")));
  const rel = relative(base, fullPath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("Path outside this server is blocked");
  }
  return fullPath;
}

function cleanRelativePath(value) {
  const clean = String(value || "").replaceAll("\\", "/").trim();
  if (!clean || clean === ".") throw new Error("Path required");
  return clean.replace(/^\/+/, "");
}

function cleanOptionalPath(value) {
  const clean = String(value || ".").replaceAll("\\", "/").trim().replace(/^\/+/, "").replace(/\/+$/, "");
  return clean && clean !== "." ? clean : ".";
}

function cleanZipEntryPath(value) {
  const clean = String(value || "").replaceAll("\\", "/").replace(/^\/+/, "");
  const normalized = normalize(clean).replaceAll("\\", "/");
  if (!clean || normalized.startsWith("../") || normalized === ".." || isAbsolute(normalized)) {
    throw new Error("Invalid zip entry path");
  }
  return clean;
}

function decodeDataUrl(dataUrl) {
  const match = String(dataUrl || "").match(/^data:[^;]*;base64,([a-zA-Z0-9+/=\r\n]+)$/);
  if (!match) throw new Error("Invalid uploaded file data");
  return Buffer.from(match[1].replace(/\s/g, ""), "base64");
}

function zipEntries(buffer) {
  if (buffer.length < 22) throw new Error("Invalid zip file");
  const maxSearch = Math.min(buffer.length, 66000);
  let eocd = -1;
  for (let offset = buffer.length - 22; offset >= buffer.length - maxSearch; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset;
      break;
    }
  }
  if (eocd < 0) throw new Error("Invalid zip file");
  const totalEntries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  const entries = [];
  for (let index = 0; index < totalEntries; index += 1) {
    if (buffer.readUInt32LE(offset) !== 0x02014b50) throw new Error("Zip central directory is unreadable");
    const flags = buffer.readUInt16LE(offset + 8);
    const method = buffer.readUInt16LE(offset + 10);
    const compressedSize = buffer.readUInt32LE(offset + 20);
    const size = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const localOffset = buffer.readUInt32LE(offset + 42);
    const encoding = flags & 0x800 ? "utf8" : "utf8";
    const name = buffer.toString(encoding, offset + 46, offset + 46 + fileNameLength).replaceAll("\\", "/");
    entries.push({ name, directory: name.endsWith("/"), method, compressedSize, size, localOffset });
    offset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries.filter((entry) => entry.name && !entry.name.startsWith("__MACOSX/"));
}

function listZipDirectory(entries, dirPath = "") {
  const cleanDir = String(dirPath || "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  const prefix = cleanDir ? `${cleanDir}/` : "";
  const map = new Map();
  for (const entry of entries) {
    if (!entry.name.startsWith(prefix)) continue;
    const rest = entry.name.slice(prefix.length);
    if (!rest) continue;
    const parts = rest.split("/").filter(Boolean);
    if (!parts.length) continue;
    const isFolder = parts.length > 1 || entry.directory;
    const label = parts[0];
    const name = `${prefix}${label}${isFolder ? "/" : ""}`;
    if (!map.has(name)) {
      map.set(name, {
        name,
        label,
        type: isFolder ? "Folder" : extname(label).replace(".", "").toUpperCase() || "File",
        size: isFolder ? "folder" : `${Math.max(1, Math.ceil(entry.size / 1024))} KB`,
        bytes: isFolder ? 0 : entry.size
      });
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.type === "Folder" && b.type !== "Folder") return -1;
    if (a.type !== "Folder" && b.type === "Folder") return 1;
    return a.label.localeCompare(b.label);
  });
}

function readZipEntry(buffer, entry) {
  const offset = entry.localOffset;
  if (buffer.readUInt32LE(offset) !== 0x04034b50) throw new Error("Zip local file header is unreadable");
  const fileNameLength = buffer.readUInt16LE(offset + 26);
  const extraLength = buffer.readUInt16LE(offset + 28);
  const start = offset + 30 + fileNameLength + extraLength;
  const compressed = buffer.subarray(start, start + entry.compressedSize);
  if (entry.method === 0) return compressed;
  if (entry.method === 8) return inflateRawSync(compressed);
  throw new Error(`Zip compression method ${entry.method} is not supported`);
}

async function readZipBuffer(server, zipPath) {
  const cleanPath = cleanRelativePath(zipPath);
  if (extname(cleanPath).toLowerCase() !== ".zip") throw new Error("Select a .zip file");
  const fullPath = safeServerPath(server, cleanPath);
  const fileStat = await stat(fullPath);
  if (fileStat.isDirectory()) throw new Error("Select a zip file, not a folder");
  if (fileStat.size > 80 * 1024 * 1024) throw new Error("Zip file is too large to open here");
  return { cleanPath, buffer: await readFile(fullPath) };
}

function parseVariables(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reduce((vars, line) => {
      const index = line.indexOf("=");
      if (index > -1) vars[line.slice(0, index).trim()] = line.slice(index + 1).trim();
      return vars;
    }, {});
}

function normalizeLoader(loader) {
  return String(loader || "").trim().toLowerCase();
}

function normalizeContentType(type) {
  return String(type || "plugin").trim().toLowerCase() === "mod" ? "mod" : "plugin";
}

async function fetchJson(url) {
  const client = url.startsWith("https:") ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const req = client(url, {
      headers: {
        "accept": "application/json",
        "user-agent": paperUserAgent
      }
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        fetchJson(res.headers.location).then(resolve, reject);
        return;
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => {
        const text = Buffer.concat(chunks).toString("utf8");
        if (!res.statusCode || res.statusCode < 200 || res.statusCode > 299) {
          reject(new Error(`Remote API failed with ${res.statusCode}: ${text.slice(0, 120)}`));
          return;
        }
        try {
          resolve(JSON.parse(text));
        } catch (error) {
          reject(new Error("Search API returned invalid JSON"));
        }
      });
    });
    req.on("error", reject);
    req.end();
  });
}

async function searchModrinth({ query, type, loader, gameVersion, limit }) {
  const facets = [type === "plugin" ? ["project_type:plugin", "project_type:mod"] : [`project_type:${type}`]];
  if (loader) facets.push([`categories:${loader}`]);
  if (gameVersion) facets.push([`versions:${gameVersion}`]);
  const url = new URL("https://api.modrinth.com/v2/search");
  url.searchParams.set("query", query);
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("index", "downloads");
  url.searchParams.set("facets", JSON.stringify(facets));
  const payload = await fetchJson(url.toString());
  return (payload.hits || []).map((hit) => ({
    source: "modrinth",
    projectId: hit.project_id,
    slug: hit.slug,
    type,
    projectType: hit.project_type,
    name: hit.title,
    version: hit.latest_version || "latest",
    description: hit.description || "",
    author: hit.author || "Modrinth",
    downloads: hit.downloads || 0,
    iconUrl: hit.icon_url || "",
    loaders: hit.categories || [],
    gameVersions: hit.versions || [],
    sourceUrl: `https://modrinth.com/${hit.project_type}/${hit.slug}`
  }));
}

async function searchSpiget({ query, limit }) {
  const url = `https://api.spiget.org/v2/search/resources/${encodeURIComponent(query)}?field=name&size=${limit}`;
  const payload = await fetchJson(url);
  return (Array.isArray(payload) ? payload : []).map((item) => ({
    source: "spiget",
    projectId: String(item.id),
    slug: String(item.id),
    type: "plugin",
    name: item.name || `Spigot resource ${item.id}`,
    version: item.version?.name || item.tag || "latest",
    description: item.tag || "Spigot/Bukkit resource",
    author: item.author?.name || "SpigotMC",
    downloads: item.downloads || 0,
    iconUrl: item.icon?.url ? `https://www.spigotmc.org/${item.icon.url.replace(/^\/+/, "")}` : "",
    loaders: ["spigot", "bukkit", "paper"],
    gameVersions: item.testedVersions || [],
    downloadUrl: `https://api.spiget.org/v2/resources/${item.id}/download`,
    sourceUrl: `https://www.spigotmc.org/resources/${item.id}/`
  }));
}

async function resolveModrinthDownload(item, loader, gameVersion) {
  const url = new URL(`https://api.modrinth.com/v2/project/${encodeURIComponent(item.projectId)}/version`);
  if (loader) url.searchParams.set("loaders", JSON.stringify([loader]));
  if (gameVersion) url.searchParams.set("game_versions", JSON.stringify([gameVersion]));
  const versions = await fetchJson(url.toString());
  const version = Array.isArray(versions) ? versions.find((entry) => entry.files?.length) : null;
  if (!version) throw new Error("No downloadable version found for this loader/version");
  const file = version.files.find((entry) => entry.primary) || version.files[0];
  return {
    url: file.url,
    version: version.version_number || item.version || "latest",
    fileName: file.filename || `${slug(item.name)}.jar`
  };
}

function flattenPaperVersions(payload) {
  let versions = [];
  if (Array.isArray(payload?.versions)) {
    versions = payload.versions;
  } else if (payload?.versions && typeof payload.versions === "object") {
    versions = Object.values(payload.versions).flat();
  }
  return Array.from(new Set(versions
    .map((version) => typeof version === "string" ? version : version?.key || version?.id || version?.name)
    .filter((version) => typeof version === "string" && paperVersionAllowed(version))))
    .sort((a, b) => compareVersions(b, a));
}

async function listPaperVersions() {
  try {
    const payload = await fetchJson(paperApiBase);
    const versions = flattenPaperVersions(payload);
    if (versions.length) return Array.from(new Set([...versions, ...paperVersionFallback])).sort((a, b) => compareVersions(b, a));
  } catch (error) {
    console.error(`Paper version list failed: ${error.message}`);
  }
  return paperVersionFallback;
}

async function installExternalContent(server, body) {
  const type = normalizeContentType(body.type);
  const folder = type === "plugin" ? "plugins" : "mods";
  const targetFolder = join(serverDir(server), folder);
  await mkdir(targetFolder, { recursive: true });
  let download = {
    url: body.downloadUrl,
    version: body.version || "latest",
    fileName: `${slug(body.name)}-${body.version || "latest"}.jar`
  };
  if (body.source === "modrinth") {
    download = await resolveModrinthDownload(body, normalizeLoader(body.loader), body.gameVersion);
  }
  if (!download.url) throw new Error("No download URL available for this result");
  const safeName = download.fileName.endsWith(".jar") ? download.fileName : `${download.fileName}.jar`;
  const targetPath = join(targetFolder, safeName.replace(/[<>:"/\\|?*]/g, "-"));
  await downloadFile(download.url, targetPath);
  const list = type === "plugin" ? server.plugins : server.mods;
  if (!list.includes(body.name)) list.push(body.name);
  await refreshServerFileList(server);
  addLog(server, `${body.name} installed from ${body.source} into ${folder}/${safeName}`);
  return { name: body.name, version: download.version, fileName: safeName };
}

function templateCommand(server) {
  return server.startup.command
    .replaceAll("{{SERVER_ID}}", server.id)
    .replaceAll("{{SERVER_NAME}}", server.name)
    .replaceAll("{{SERVER_MEMORY}}", String(server.ram * 1024))
    .replaceAll("{{SERVER_PORT}}", primaryPort(server));
}

async function resolvePaperDownload(server) {
  const requestedVersion = normalizePaperVersion(server.startup?.variables?.MC_VERSION || "latest");
  const versions = await listPaperVersions();
  const version = requestedVersion === "latest" ? versions[0] : requestedVersion;
  if (!versions.includes(version)) throw new Error(`Paper ${version} is not available`);
  let download;
  let buildNumber = "latest";
  try {
    const buildsPayload = await fetchJson(`${paperApiBase}/versions/${encodeURIComponent(version)}/builds`);
    const builds = (Array.isArray(buildsPayload) ? buildsPayload : buildsPayload.builds || [])
      .filter((build) => build?.downloads?.["server:default"]?.url)
      .sort((a, b) => Number(b.id ?? b.number ?? b.build ?? 0) - Number(a.id ?? a.number ?? a.build ?? 0));
    const stableBuilds = builds.filter((build) => String(build.channel || "STABLE").toUpperCase() === "STABLE");
    const latestBuild = stableBuilds[0] || builds[0];
    if (!latestBuild) throw new Error("No fill build");
    download = latestBuild.downloads["server:default"];
    buildNumber = latestBuild.id ?? latestBuild.number ?? latestBuild.build ?? "latest";
  } catch {
    const legacyPayload = await fetchJson(`${paperLegacyApiBase}/versions/${encodeURIComponent(version)}/builds`);
    const builds = (legacyPayload.builds || []).sort((a, b) => Number(b.build || 0) - Number(a.build || 0));
    const latestBuild = builds[0];
    if (!latestBuild) throw new Error(`No Paper server.jar build found for ${version}`);
    buildNumber = latestBuild.build;
    const fileName = latestBuild.downloads?.application?.name || `paper-${version}-${buildNumber}.jar`;
    download = {
      url: `${paperLegacyApiBase}/versions/${encodeURIComponent(version)}/builds/${buildNumber}/downloads/${fileName}`,
      name: fileName
    };
  }
  return {
    version,
    selected: requestedVersion,
    build: buildNumber,
    url: download.url,
    fileName: download.name || `paper-${version}-${buildNumber}.jar`
  };
}

async function resolvePurpurDownload(server) {
  const requestedVersion = normalizePaperVersion(server.startup?.variables?.MC_VERSION || "latest");
  let version = requestedVersion;
  if (version === "latest") {
    const payload = await fetchJson(purpurApiBase);
    version = [...(payload.versions || paperVersionFallback)].sort(compareVersions).reverse()[0] || "1.21.4";
  }
  return {
    version,
    selected: requestedVersion,
    build: "latest",
    url: `${purpurApiBase}/${encodeURIComponent(version)}/latest/download`,
    fileName: `purpur-${version}-latest.jar`
  };
}

async function resolveVelocityDownload() {
  const payload = await fetchJson(`${velocityApiBase}/versions`);
  const version = [...(payload.versions || [])].sort(compareVersions).reverse()[0];
  if (!version) throw new Error("No Velocity version found");
  const buildsPayload = await fetchJson(`${velocityApiBase}/versions/${encodeURIComponent(version)}/builds`);
  const builds = (buildsPayload.builds || []).sort((a, b) => Number(b.build || 0) - Number(a.build || 0));
  const latestBuild = builds[0];
  if (!latestBuild) throw new Error("No Velocity build found");
  const fileName = latestBuild.downloads?.application?.name || `velocity-${version}-${latestBuild.build}.jar`;
  return {
    version,
    selected: "latest",
    build: latestBuild.build,
    url: `${velocityApiBase}/versions/${encodeURIComponent(version)}/builds/${latestBuild.build}/downloads/${fileName}`,
    fileName
  };
}

async function resolveFabricDownload(server) {
  const requestedVersion = normalizePaperVersion(server.startup?.variables?.MC_VERSION || "latest");
  const gameVersion = requestedVersion === "latest" ? "1.21.4" : requestedVersion;
  const loaderVersions = await fetchJson(`https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(gameVersion)}`);
  const loader = (loaderVersions || []).find((entry) => entry.loader?.stable)?.loader || loaderVersions?.[0]?.loader;
  const installers = await fetchJson("https://meta.fabricmc.net/v2/versions/installer");
  const installer = (installers || []).find((entry) => entry.stable) || installers?.[0];
  if (!loader?.version || !installer?.version) throw new Error(`No Fabric loader found for ${gameVersion}`);
  return {
    version: gameVersion,
    selected: requestedVersion,
    build: loader.version,
    url: `https://meta.fabricmc.net/v2/versions/loader/${encodeURIComponent(gameVersion)}/${encodeURIComponent(loader.version)}/${encodeURIComponent(installer.version)}/server/jar`,
    fileName: `fabric-server-${gameVersion}-${loader.version}.jar`
  };
}

function resolveBungeeDownload() {
  return {
    version: "latest",
    selected: "latest",
    build: "lastSuccessfulBuild",
    url: "https://ci.md-5.net/job/BungeeCord/lastSuccessfulBuild/artifact/bootstrap/target/BungeeCord.jar",
    fileName: "BungeeCord.jar"
  };
}

async function resolveForgeInstaller(server) {
  const requestedVersion = normalizePaperVersion(server.startup?.variables?.MC_VERSION || "latest");
  const mcVersion = requestedVersion === "latest" ? "1.21.4" : requestedVersion;
  const promos = await fetchJson("https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json");
  const forgeVersion = promos.promos?.[`${mcVersion}-latest`] || promos.promos?.[`${mcVersion}-recommended`];
  if (!forgeVersion) throw new Error(`No Forge build found for Minecraft ${mcVersion}`);
  const coordinate = `${mcVersion}-${forgeVersion}`;
  return {
    version: mcVersion,
    forgeVersion,
    url: `https://maven.minecraftforge.net/net/minecraftforge/forge/${coordinate}/forge-${coordinate}-installer.jar`,
    fileName: `forge-${coordinate}-installer.jar`
  };
}

async function ensureForgeServer(server) {
  const base = serverDir(server);
  const runScript = join(base, "run.sh");
  const selectedVersion = normalizePaperVersion(server.startup?.variables?.MC_VERSION || "latest");
  if (existsSync(runScript)
    && server.startup?.variables?.JAR_TEMPLATE === "minecraft-forge"
    && server.startup?.variables?.JAR_SELECTED === selectedVersion) return;
  const installer = await resolveForgeInstaller(server);
  const installerPath = join(base, installer.fileName);
  addLog(server, `Downloading Forge ${installer.forgeVersion} installer for Minecraft ${installer.version}...`);
  await downloadFile(installer.url, installerPath);
  addLog(server, "Running Forge --installServer...");
  await new Promise((resolve, reject) => {
    const child = spawn("java", ["-jar", installerPath, "--installServer"], {
      cwd: base,
      windowsHide: true
    });
    child.stdout.on("data", (chunk) => addLogChunk(server, chunk));
    child.stderr.on("data", (chunk) => addLogChunk(server, chunk, "stderr: "));
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`Forge installer exited with code ${code}`)));
  });
  server.startup.variables.JAR_TEMPLATE = "minecraft-forge";
  server.startup.variables.JAR_SELECTED = selectedVersion;
  server.startup.variables.JAR_VERSION = installer.version;
  server.startup.variables.JAR_BUILD = installer.forgeVersion;
  server.startup.variables.JAR_FILE = installer.fileName;
  addLog(server, `Forge ${installer.forgeVersion} installed. run.sh is ready.`);
}

async function resolveServerJarDownload(server) {
  const template = templateForEgg(server.egg);
  if (template.id === "minecraft-purpur") return resolvePurpurDownload(server);
  if (template.id === "velocity") return resolveVelocityDownload(server);
  if (template.id === "minecraft-fabric") return resolveFabricDownload(server);
  if (template.id === "bungee") return resolveBungeeDownload();
  return resolvePaperDownload(server);
}

async function ensureRealMinecraftJar(server) {
  const command = templateCommand(server);
  if (!/\bserver\.jar\b/i.test(command)) return;
  const jarPath = join(serverDir(server), "server.jar");
  const template = templateForEgg(server.egg);
  const selectedVersion = normalizePaperVersion(server.startup?.variables?.MC_VERSION || "latest");
  const installedMatches = existsSync(jarPath)
    && server.startup?.variables?.JAR_TEMPLATE === template.id
    && server.startup?.variables?.JAR_SELECTED === selectedVersion;
  if (installedMatches) return;
  addLog(server, `${existsSync(jarPath) ? "Replacing" : "Downloading"} ${template.name} server.jar for ${selectedVersion === "latest" ? "latest stable" : selectedVersion}...`);
  const download = await resolveServerJarDownload(server);
  await downloadFile(download.url, jarPath);
  server.startup.variables.JAR_TEMPLATE = template.id;
  server.startup.variables.JAR_SELECTED = download.selected;
  server.startup.variables.MC_VERSION = download.version;
  if (download.selected === "latest") server.startup.variables.MC_VERSION = "latest";
  server.startup.variables.JAR_BUILD = String(download.build);
  server.startup.variables.JAR_VERSION = download.version;
  server.startup.variables.JAR_FILE = download.fileName;
  addLog(server, `${template.name} ${download.version} build ${download.build} downloaded as server.jar.`);
}

async function startServer(server) {
  ensureServerActive(server);
  if (processes.has(server.id)) return;
  await ensureServerFiles(server);
  if (/minecraft|paper|purpur|forge|fabric|velocity|bungee/i.test(server.egg || "")) {
    try {
      if (templateForEgg(server.egg).id === "minecraft-forge") await ensureForgeServer(server);
      else await ensureRealMinecraftJar(server);
    } catch (error) {
      server.status = "stopped";
      addLog(server, `Start blocked: ${error.message}`);
      addLog(server, "Upload server.jar in File Manager or connect internet, then press Start again.");
      await persist();
      throw error;
    }
  }
  const command = templateCommand(server);
  const child = spawn(command, {
    cwd: serverDir(server),
    shell: true,
    windowsHide: true,
    env: {
      ...process.env,
      SERVER_ID: server.id,
      SERVER_NAME: server.name,
      SERVER_PORT: primaryPort(server),
      SERVER_MEMORY: String(server.ram * 1024)
    }
  });
  processes.set(server.id, child);
  server.status = "running";
  addLog(server, `Process started: ${command}`);
  child.stdout.on("data", (chunk) => {
    addLogChunk(server, chunk);
    persist().catch(console.error);
  });
  child.stderr.on("data", (chunk) => {
    addLogChunk(server, chunk, "stderr: ");
    persist().catch(console.error);
  });
  child.on("error", (error) => {
    processes.delete(server.id);
    server.status = "stopped";
    addLog(server, `Process error: ${error.message}`);
    persist().catch(console.error);
  });
  child.on("exit", (code) => {
    processes.delete(server.id);
    const expected = expectedStops.delete(server.id);
    const restartCount = Number(server.autoHeal?.restarts || 0);
    const shouldHeal = !expected && server.autoHeal?.enabled && server.status !== "stopped" && restartCount < 3;
    if (server.status !== "stopped") server.status = "stopped";
    addLog(server, `Process exited with code ${code ?? "unknown"}.`);
    if (shouldHeal) {
      server.autoHeal.restarts = restartCount + 1;
      server.autoHeal.lastAction = `Restart queued after exit ${code ?? "unknown"}`;
      addLog(server, "Auto-heal: restart queued in 3 seconds.");
      setTimeout(() => {
        startServer(server).then(() => persist()).catch((error) => {
          server.autoHeal.lastAction = `Restart failed: ${error.message}`;
          addLog(server, `Auto-heal failed: ${error.message}`);
          persist().catch(console.error);
        });
      }, 3000);
    } else if (!expected && server.autoHeal?.enabled && restartCount >= 3) {
      server.autoHeal.lastAction = "Auto-heal paused after 3 restart attempts";
      addLog(server, server.autoHeal.lastAction);
    }
    persist().catch(console.error);
  });
}

async function stopServer(server, force = false) {
  const child = processes.get(server.id);
  if (child) {
    expectedStops.add(server.id);
    if (force) {
      child.kill();
      processes.delete(server.id);
    } else {
      addLog(server, "Sending Minecraft stop command...");
      if (child.stdin.writable) child.stdin.write("stop\n");
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (processes.has(server.id)) child.kill();
          resolve();
        }, 8000);
        child.once("exit", () => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }
  server.status = "stopped";
  addLog(server, "Stop signal sent.");
}

async function createBackup(server, name = "") {
  await refreshServerFileList(server);
  const backupId = uid("bk");
  const label = name || `${slug(server.name)}-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const target = join(backupRoot, server.id, backupId);
  await copyDir(serverDir(server), target);
  const backup = {
    id: backupId,
    name: label,
    size: `${server.files.length} files`,
    createdAt: new Date().toISOString(),
    path: relative(root, target)
  };
  server.backups.unshift(backup);
  const limit = normalizeBackupLimit(server.backupLimit, 10);
  if (limit > 0 && server.backups.length > limit) {
    const removed = server.backups.splice(limit);
    for (const oldBackup of removed) {
      const oldPath = normalize(join(root, oldBackup.path || ""));
      if (oldPath.startsWith(normalize(backupRoot))) await rm(oldPath, { recursive: true, force: true });
    }
    addLog(server, `Backup limit ${limit} reached. Old restore point${removed.length === 1 ? "" : "s"} pruned.`);
  }
  addLog(server, `Backup snapshot created: ${label}`);
  return backup;
}

async function restoreBackup(server, backupId) {
  const backup = server.backups.find((item) => item.id === backupId);
  if (!backup) throw new Error("Backup not found");
  const source = normalize(join(root, backup.path));
  if (!source.startsWith(normalize(backupRoot))) throw new Error("Backup path is invalid");
  await stopServer(server, true);
  const target = serverDir(server);
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await copyDir(source, target);
  await ensureServerFiles(server);
  await refreshServerFileList(server);
  addLog(server, `Restored backup: ${backup.name}`);
}

let maintenanceRunning = false;

async function runMaintenance() {
  if (maintenanceRunning) return;
  maintenanceRunning = true;
  try {
    let changed = false;
    const now = Date.now();
    for (const server of state.servers || []) {
      for (const schedule of server.schedules || []) {
        if (!cronDue(schedule)) continue;
        try {
          await runScheduleAction(server, schedule);
          changed = true;
        } catch (error) {
          schedule.lastRun = new Date().toISOString();
          addLog(server, `Scheduled task failed: ${schedule.name}: ${error.message}`);
          changed = true;
        }
      }
      if (server.autoBackup?.hourly !== false && now - new Date(server.autoBackup?.lastHourly || 0).getTime() >= 60 * 60 * 1000) {
        await createBackup(server, `${server.name}-hourly-auto`);
        server.autoBackup = { ...(server.autoBackup || {}), lastHourly: new Date(now).toISOString() };
        addLog(server, "Hourly auto backup completed.");
        changed = true;
      }
      if (server.autoBackup?.daily !== false && now - new Date(server.autoBackup?.lastDaily || 0).getTime() >= 24 * 60 * 60 * 1000) {
        await createBackup(server, `${server.name}-daily-auto`);
        server.autoBackup = { ...(server.autoBackup || {}), lastDaily: new Date(now).toISOString() };
        addLog(server, "Daily auto backup completed.");
        changed = true;
      }
    }
    if (changed) await persist();
  } catch (error) {
    console.error(`[HeronPanel] maintenance failed: ${error.message}`);
  } finally {
    maintenanceRunning = false;
  }
}

function buildOptimizerReport(server) {
  const logs = (server.console || []).join("\n").toLowerCase();
  const suggestions = [];
  const conflicts = [];
  let score = 100;
  if (logs.includes("can't keep up") || logs.includes("server overloaded")) {
    score -= 20;
    suggestions.push("TPS warning detected. Lower view-distance, reduce entities, and profile heavy plugins.");
  }
  if (logs.includes("outofmemory") || logs.includes("java heap space")) {
    score -= 30;
    suggestions.push("RAM pressure detected. Increase memory or remove heavy plugins/mods.");
  }
  if (logs.includes("exception") || logs.includes("error")) {
    score -= 15;
    suggestions.push("Errors found in console. Open logs/latest.log and check the first stack trace.");
  }
  if ((server.plugins || []).length > 18) {
    score -= 10;
    suggestions.push("High plugin count. Disable unused plugins and restart to measure TPS.");
  }
  if ((server.mods || []).length && (server.plugins || []).length) {
    conflicts.push("Plugins and mods are both installed. Keep Paper plugins on Paper, and mods on Fabric/Forge.");
  }
  if (Number(server.ram || 0) < 3 && ((server.plugins || []).length > 8 || (server.mods || []).length > 4)) {
    score -= 10;
    suggestions.push("RAM is low for the installed content count. Try 4 GB or more.");
  }
  if (!suggestions.length) suggestions.push("No critical issue detected. Keep backups and test after every new plugin.");
  return {
    score: Math.max(5, score),
    scannedAt: new Date().toISOString(),
    suggestions,
    conflicts,
    removeCandidates: [...(server.disabledPlugins || []), ...(server.disabledMods || [])].slice(0, 6),
    summary: `${suggestions.length} recommendation${suggestions.length === 1 ? "" : "s"} generated from logs, resources, and installed content.`
  };
}

function buildNetworkAnalytics(server) {
  const logs = (server.console || []).slice(-120);
  const buckets = Array.from({ length: 12 }, () => 0);
  logs.forEach((line, index) => {
    const bucket = Math.min(11, Math.floor(index / Math.max(1, Math.ceil(logs.length / 12))));
    buckets[bucket] += /joined the game|lost connection|connected/i.test(line) ? 8 : /error|exception|failed/i.test(line) ? 5 : 1;
  });
  const points = buckets.map((value) => value + (server.status === "running" ? 2 : 0));
  const spike = Math.max(...points, 0);
  const suspicious = [];
  if ((server.ports || []).length > 3) suspicious.push("Too many exposed ports");
  if ((server.plugins || []).some((name) => /backdoor|forceop|shell|eval/i.test(name))) suspicious.push("Dangerous plugin pattern");
  return {
    attackLevel: suspicious.length ? "review" : "normal",
    packetsPerSecond: spike,
    traffic: points,
    suspicious,
    note: suspicious.length ? "Review security findings and provider firewall logs." : "Traffic model is based on real panel logs and exposed-port state."
  };
}

function buildHealthReport(server) {
  const logs = (server.console || []).join("\n").toLowerCase();
  const pluginCount = (server.plugins || []).length;
  const modCount = (server.mods || []).length;
  const exposedPorts = (server.ports || []).length;
  const dangerousPlugins = (server.plugins || []).filter((name) => /skript|eval|op|forceop|authme|cracked|backdoor|shell/i.test(name));
  const opPlayers = state.players.filter((player) => player.serverId === server.id && ["Owner", "Operator"].includes(player.role));
  let optimization = 96;
  let security = 94;
  let performance = 95;
  if (logs.includes("can't keep up") || logs.includes("overloaded")) performance -= 25;
  if (logs.includes("outofmemory") || logs.includes("java heap")) performance -= 30;
  if (pluginCount > 20) optimization -= 15;
  if (modCount > 12) optimization -= 10;
  if (Number(server.ram || 0) < Math.max(2, Math.ceil((pluginCount + modCount) / 6))) performance -= 12;
  if (dangerousPlugins.length) security -= 30;
  if (exposedPorts > 3) security -= 10;
  if (opPlayers.length > 2) security -= 8;
  const issues = [
    ...dangerousPlugins.map((name) => `Dangerous plugin pattern: ${name}`),
    ...(exposedPorts > 3 ? [`${exposedPorts} exposed ports. Keep only required ports open.`] : []),
    ...(opPlayers.length > 2 ? [`${opPlayers.length} OP-level players detected.`] : []),
    ...(logs.includes("exception") ? ["Console contains exception logs."] : [])
  ];
  return {
    optimization: Math.max(5, optimization),
    security: Math.max(5, security),
    performance: Math.max(5, performance),
    recommendedRamGb: Math.max(1, Math.ceil(1.5 + pluginCount / 8 + modCount / 4 + Number(server.options?.slots || 60) / 80)),
    issues,
    scannedAt: new Date().toISOString()
  };
}

async function applyRamAutoAllocator(server) {
  const report = buildHealthReport(server);
  server.ram = Math.min(Math.max(report.recommendedRamGb, Number(server.ram || 1)), 64);
  server.startup.variables.SERVER_MEMORY = String(server.ram * 1024);
  addLog(server, `RAM Auto Allocator set RAM to ${server.ram} GB.`);
  return report;
}

async function applyPerformanceMode(server, modeId) {
  const mode = performanceModes[String(modeId || "").trim().toLowerCase()];
  if (!mode) throw new Error("Performance mode not found");
  server.options = {
    ...server.options,
    pvp: mode.pvp,
    monsters: mode.monsters,
    animals: mode.animals
  };
  await mkdir(serverDir(server), { recursive: true });
  await writeFile(join(serverDir(server), "spigot.yml"), [
    "settings:",
    `  view-distance: ${mode.viewDistance}`,
    `  simulation-distance: ${mode.simulationDistance}`
  ].join("\n") + "\n");
  await writeFile(join(serverDir(server), "heron-performance-mode.json"), JSON.stringify({ mode: modeId, appliedAt: new Date().toISOString(), ...mode }, null, 2));
  await ensureServerFiles(server);
  await refreshServerFileList(server);
  addLog(server, mode.note);
  addActivity(`${server.name}: ${modeId} performance mode applied.`);
}

function commandMacro(server, id) {
  return (server.commandMacros || []).find((macro) => macro.id === id);
}

function cronDue(schedule, now = new Date()) {
  const cron = String(schedule.cron || "").trim();
  if (!cron || schedule.active === false) return false;
  const lastMinute = Math.floor(new Date(schedule.lastRun || 0).getTime() / 60000);
  const thisMinute = Math.floor(now.getTime() / 60000);
  if (lastMinute === thisMinute) return false;
  const [minute = "*", hour = "*"] = cron.split(/\s+/);
  const matchPart = (part, value) => {
    if (part === "*") return true;
    if (part.startsWith("*/")) {
      const step = Number(part.slice(2));
      return Number.isFinite(step) && step > 0 && value % step === 0;
    }
    return part.split(",").some((item) => Number(item) === value);
  };
  return matchPart(minute, now.getMinutes()) && matchPart(hour, now.getHours());
}

async function runScheduleAction(server, schedule) {
  const action = String(schedule.action || "").trim();
  if (action === "backup") await createBackup(server, `${server.name}-${schedule.name}`);
  else if (action === "restart") {
    await stopServer(server, "restart");
    setTimeout(() => startServer(server).catch(console.error), 1200);
  } else if (action === "start") await startServer(server);
  else if (action === "stop") await stopServer(server);
  else if (action.startsWith("command:")) sendServerCommand(server, action.slice("command:".length));
  else if (action.startsWith("broadcast:")) addLog(server, `[Broadcast] ${action.slice("broadcast:".length).trim()}`);
  else throw new Error(`Unknown schedule action: ${action}`);
  schedule.lastRun = new Date().toISOString();
  addLog(server, `Scheduled task ran: ${schedule.name}`);
}

function sendServerCommand(server, command) {
  const clean = String(command || "").trim();
  if (!clean) throw new Error("Command required");
  const child = processes.get(server.id);
  if (child && child.stdin.writable) {
    child.stdin.write(`${clean}\n`);
    addLog(server, `> ${clean}`);
    return;
  }
  addLog(server, `Command rejected while offline: ${clean}`);
  throw new Error("Server is offline. Start it before sending console commands.");
}

async function copyDir(from, to) {
  await mkdir(to, { recursive: true });
  const entries = await readdir(from, { withFileTypes: true });
  for (const entry of entries) {
    const src = join(from, entry.name);
    const dest = join(to, entry.name);
    if (entry.isDirectory()) await copyDir(src, dest);
    else await copyFile(src, dest);
  }
}

async function installContent(server, type, itemId) {
  const catalog = type === "plugin" ? state.pluginCatalog : state.modCatalog;
  const item = catalog.find((entry) => entry.id === itemId);
  if (!item) throw new Error("Catalog item not found");
  if (!item.sourceUrl) {
    const searchType = normalizeContentType(type);
    const loader = searchType === "plugin" ? "paper" : "fabric";
    const results = await searchModrinth({
      query: item.name,
      type: searchType,
      loader,
      gameVersion: server.startup?.variables?.MC_VERSION === "latest" ? "" : server.startup?.variables?.MC_VERSION,
      limit: 6
    });
    const match = results.find((entry) => entry.name.toLowerCase() === item.name.toLowerCase()) || results[0];
    if (!match) throw new Error(`${item.name} has no real download source. Use online search or upload the jar.`);
    return installExternalContent(server, { ...match, type: searchType, loader });
  }
  const folder = type === "plugin" ? "plugins" : "mods";
  const targetFolder = join(serverDir(server), folder);
  await mkdir(targetFolder, { recursive: true });
  const targetName = `${slug(item.name)}-${item.version}.jar`;
  const targetPath = join(targetFolder, targetName);
  await downloadFile(item.sourceUrl, targetPath);
  const list = type === "plugin" ? server.plugins : server.mods;
  if (!list.includes(item.name)) list.push(item.name);
  await refreshServerFileList(server);
  addLog(server, `${item.name} installed into ${folder}/${targetName}`);
  return item;
}

function contentFolder(type) {
  return normalizeContentType(type) === "mod" ? "mods" : "plugins";
}

function contentList(server, type) {
  return normalizeContentType(type) === "mod" ? server.mods : server.plugins;
}

function disabledContentList(server, type) {
  if (normalizeContentType(type) === "mod") {
    server.disabledMods = server.disabledMods || [];
    return server.disabledMods;
  }
  server.disabledPlugins = server.disabledPlugins || [];
  return server.disabledPlugins;
}

function contentNameFromFile(name) {
  return String(name || "content")
    .replace(/\.disabled$/i, "")
    .replace(/\.(jar|zip)$/i, "")
    .replace(/[-_]+/g, " ")
    .trim() || "Uploaded content";
}

async function uploadContentFiles(server, type, files) {
  const folder = contentFolder(type);
  const targetFolder = join(serverDir(server), folder);
  await mkdir(targetFolder, { recursive: true });
  const installed = [];
  let totalBytes = 0;
  for (const file of files.slice(0, 40)) {
    const originalName = cleanRelativePath(file.name || file.relativePath || "plugin.jar").split("/").pop();
    if (!/\.(jar|zip)$/i.test(originalName)) throw new Error("Only .jar or .zip content files are supported");
    const buffer = decodeDataUrl(file.dataUrl);
    totalBytes += buffer.length;
    if (totalBytes > 120 * 1024 * 1024) throw new Error("Content upload batch must stay under 120 MB");
    await writeFile(join(targetFolder, originalName), buffer);
    const displayName = contentNameFromFile(originalName);
    const list = contentList(server, type);
    if (!list.includes(displayName)) list.push(displayName);
    installed.push(displayName);
  }
  await refreshServerFileList(server);
  addLog(server, `Uploaded ${installed.length} ${normalizeContentType(type)} file${installed.length === 1 ? "" : "s"} by drag/drop.`);
  return installed;
}

async function findContentFile(server, type, name) {
  const folder = join(serverDir(server), contentFolder(type));
  if (!existsSync(folder)) return null;
  const entries = await readdir(folder, { withFileTypes: true });
  const wanted = slug(name);
  const match = entries.find((entry) => entry.isFile() && slug(contentNameFromFile(entry.name)).includes(wanted));
  return match ? join(folder, match.name) : null;
}

async function toggleContent(server, type, name, enabled) {
  const disabled = disabledContentList(server, type);
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new Error("Content name required");
  const currentFile = await findContentFile(server, type, cleanName);
  if (enabled) {
    server.disabledPlugins = (server.disabledPlugins || []).filter((item) => item !== cleanName);
    server.disabledMods = (server.disabledMods || []).filter((item) => item !== cleanName);
    if (currentFile && currentFile.endsWith(".disabled")) await rename(currentFile, currentFile.replace(/\.disabled$/i, ""));
  } else {
    if (!disabled.includes(cleanName)) disabled.push(cleanName);
    if (currentFile && !currentFile.endsWith(".disabled")) await rename(currentFile, `${currentFile}.disabled`);
  }
  await refreshServerFileList(server);
  addLog(server, `${cleanName} ${enabled ? "enabled" : "disabled"}.`);
}

async function updateContent(server, type, name) {
  const catalog = normalizeContentType(type) === "mod" ? state.modCatalog : state.pluginCatalog;
  const item = catalog.find((entry) => entry.name === name);
  if (item) {
    await installContent(server, type, item.id);
    return item.name;
  }
  addLog(server, `${name} update checked. Add a catalog source URL for automatic jar replacement.`);
  return name;
}

function scanContentUpdates(server, type = "plugin") {
  const catalog = normalizeContentType(type) === "mod" ? state.modCatalog : state.pluginCatalog;
  const installed = contentList(server, type);
  return installed.map((name) => {
    const item = catalog.find((entry) => entry.name.toLowerCase() === String(name).toLowerCase());
    return {
      name,
      installed: "installed",
      latest: item?.version || "unknown",
      updateAvailable: Boolean(item?.sourceUrl),
      sourceUrl: item?.sourceUrl || ""
    };
  });
}

async function writePermissionsFile(server) {
  const lines = ["groups:"];
  for (const group of server.permissions?.groups || []) {
    lines.push(`  ${group.name}:`);
    lines.push("    permissions:");
    for (const permission of group.permissions || []) lines.push(`      - ${permission}`);
  }
  await mkdir(join(serverDir(server), "plugins", "LuckPerms"), { recursive: true });
  await writeFile(join(serverDir(server), "plugins", "LuckPerms", "heron-permissions.yml"), `${lines.join("\n")}\n`);
  await refreshServerFileList(server);
}

async function buildWorldMap(server) {
  const regionDir = join(serverDir(server), "world", "region");
  const regions = [];
  if (existsSync(regionDir)) {
    for (const entry of await readdir(regionDir, { withFileTypes: true })) {
      const match = entry.name.match(/^r\.(-?\d+)\.(-?\d+)\.mca$/);
      if (entry.isFile() && match) regions.push({ x: Number(match[1]), z: Number(match[2]), file: entry.name });
    }
  }
  return {
    regions,
    generatedAt: new Date().toISOString(),
    note: regions.length ? "Region files detected from world/region." : "No region files found yet. Start or upload a world first."
  };
}

function runServerShell(server, command) {
  const clean = String(command || "").trim();
  if (!clean) throw new Error("Command required");
  if (/[;&|`]/.test(clean)) throw new Error("Shell chaining is blocked in Web SSH terminal");
  return new Promise((resolve, reject) => {
    const child = spawn(clean, {
      cwd: serverDir(server),
      shell: true,
      windowsHide: true,
      timeout: 15000
    });
    let output = "";
    child.stdout.on("data", (chunk) => output += chunk);
    child.stderr.on("data", (chunk) => output += chunk);
    child.on("error", reject);
    child.on("exit", (code) => resolve({ code, output: output.slice(-12000) }));
  });
}

async function writeServerIcon(server, dataUrl) {
  const match = String(dataUrl || "").match(/^data:image\/png;base64,([a-zA-Z0-9+/=]+)$/);
  if (!match) throw new Error("Use a PNG image for server icon");
  const buffer = Buffer.from(match[1], "base64");
  if (buffer.length > 1024 * 1024) throw new Error("Server icon must be under 1 MB");
  await writeFile(join(serverDir(server), "server-icon.png"), buffer);
}

async function downloadFile(url, targetPath) {
  const client = url.startsWith("https:") ? httpsRequest : httpRequest;
  await new Promise((resolve, reject) => {
    const req = client(url, {
      headers: {
        "user-agent": paperUserAgent
      }
    }, (res) => {
      if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        downloadFile(res.headers.location, targetPath).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`Download failed with ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", async () => {
        await writeFile(targetPath, Buffer.concat(chunks));
        resolve();
      });
    });
    req.on("error", reject);
    req.end();
  });
}

function findServer(id) {
  const server = state.servers.find((item) => item.id === id);
  if (!server) throw new Error("Server not found");
  return server;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(text));
      } catch (error) {
        reject(new Error("Invalid JSON body"));
      }
    });
    request.on("error", reject);
  });
}

function sendJson(response, payload, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload));
}

function sendError(response, error, status = 400) {
  sendJson(response, { ok: false, error: error.message || String(error) }, error.status || status);
}

async function handleApi(request, response, url) {
  const path = url.pathname;
  try {
    if (request.method === "POST" && path === "/api/auth/login") {
      const body = await readBody(request);
      const identifier = String(body.identifier || "").trim().toLowerCase();
      const user = findUserByLogin(identifier);
      if (!user || !verifyPassword(user, body.password)) {
        const error = new Error("Invalid login details");
        error.status = 401;
        throw error;
      }
      ensureUserCanLogin(user);
      const token = randomUUID();
      sessions.set(token, user.id);
      sendJson(response, { ok: true, token, user: sanitizeUser(user) });
      return;
    }

    if (request.method === "POST" && path === "/api/auth/register") {
      const body = await readBody(request);
      const username = String(body.username || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");
      if (username.length < 3) throw new Error("Username must be at least 3 characters");
      if (!email.includes("@")) throw new Error("Valid email required");
      if (password.length < 6) throw new Error("Password must be at least 6 characters");
      if (loginIdentityTaken(username) || loginIdentityTaken(email)) {
        throw new Error("User already exists");
      }
      const user = {
        id: uid("usr"),
        username,
        email,
        role: "user",
        status: state.security?.registrationApproval !== false ? "pending" : "active",
        passwordHash: hashSecret(password),
        backupPasswordHash: "",
        loginAliases: [],
        createdAt: new Date().toISOString()
      };
      state.users.push(user);
      await persist();
      if (user.status === "pending") {
        addActivity(`Registration pending approval: ${user.username}.`);
        sendJson(response, { ok: true, pending: true, message: "Registration submitted. Admin approval required." });
        return;
      }
      const token = randomUUID();
      sessions.set(token, user.id);
      sendJson(response, { ok: true, token, user: sanitizeUser(user) });
      return;
    }

    if (request.method === "GET" && path === "/api/auth/me") {
      const user = authenticate(request);
      sendJson(response, { ok: true, user: sanitizeUser(user) });
      return;
    }

    if (request.method === "POST" && path === "/api/auth/logout") {
      const header = request.headers.authorization || "";
      const token = header.startsWith("Bearer ") ? header.slice(7) : "";
      sessions.delete(token);
      sendJson(response, { ok: true });
      return;
    }

    const currentUser = authenticate(request);

    if (request.method === "POST" && path === "/api/account/settings") {
      const body = await readBody(request);
      const username = String(body.username || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const currentPassword = String(body.currentPassword || "");
      const newPassword = String(body.newPassword || "");
      if (username.length < 3) throw new Error("Username must be at least 3 characters");
      if (!email.includes("@")) throw new Error("Valid email required");
      if (loginIdentityTaken(username, currentUser.id) || loginIdentityTaken(email, currentUser.id)) {
        throw new Error("Username or email already used");
      }
      if (newPassword) {
        if (newPassword.length < 6) throw new Error("New password must be at least 6 characters");
        if (!verifyPassword(currentUser, currentPassword)) {
          const error = new Error("Current password is wrong");
          error.status = 401;
          throw error;
        }
        currentUser.passwordHash = hashSecret(newPassword);
      }
      currentUser.username = username;
      currentUser.email = email;
      await persist();
      sendJson(response, { ok: true, state: publicState(currentUser), user: sanitizeUser(currentUser) });
      return;
    }

    if (request.method === "GET" && path === "/api/state") {
      sendJson(response, { ok: true, state: publicState(currentUser), user: sanitizeUser(currentUser) });
      return;
    }

    if (request.method === "POST" && path === "/api/api-keys") {
      requireAdmin(currentUser);
      const body = await readBody(request);
      const rawKey = `hp_${randomUUID().replaceAll("-", "")}${randomUUID().replaceAll("-", "")}`;
      const key = {
        id: uid("key"),
        name: String(body.name || "Panel API Key").trim(),
        prefix: rawKey.slice(0, 10),
        hash: hashSecret(rawKey),
        userId: currentUser.id,
        createdAt: new Date().toISOString(),
        lastUsed: ""
      };
      state.apiKeys.unshift(key);
      addActivity(`API key created: ${key.name}.`);
      await persist();
      sendJson(response, { ok: true, apiKey: rawKey, state: publicState(currentUser) });
      return;
    }

    const apiKeyDeleteMatch = path.match(/^\/api\/api-keys\/([^/]+)\/delete$/);
    if (request.method === "POST" && apiKeyDeleteMatch) {
      requireAdmin(currentUser);
      state.apiKeys = (state.apiKeys || []).filter((key) => key.id !== apiKeyDeleteMatch[1]);
      addActivity("API key deleted.");
      await persist();
      sendJson(response, { ok: true, state: publicState(currentUser) });
      return;
    }

    if (request.method === "POST" && path === "/api/security") {
      requireAdmin(currentUser);
      const body = await readBody(request);
      state.security = {
        ...(state.security || {}),
        ipBlacklist: String(body.ipBlacklist || "").split(/\r?\n|,/).map((ip) => ip.trim()).filter(Boolean),
        registrationApproval: body.registrationApproval !== false,
        rateLimit: body.rateLimit !== false,
        auditLog: state.security?.auditLog || []
      };
      addActivity("Security settings updated.");
      await persist();
      sendJson(response, { ok: true, state: publicState(currentUser) });
      return;
    }

    const userActionMatch = path.match(/^\/api\/users\/([^/]+)\/action$/);
    if (request.method === "POST" && userActionMatch) {
      requireAdmin(currentUser);
      const body = await readBody(request);
      const user = state.users.find((item) => item.id === userActionMatch[1]);
      if (!user) throw new Error("User not found");
      if (user.id === adminSeed.id) throw new Error("Built-in owner cannot be modified");
      const action = String(body.action || "").trim();
      if (action === "approve") user.status = "active";
      else if (action === "suspend" || action === "ban") user.status = "suspended";
      else if (action === "delete") state.users = state.users.filter((item) => item.id !== user.id);
      else throw new Error("Invalid user action");
      addActivity(`User ${user.username}: ${action}.`);
      await persist();
      sendJson(response, { ok: true, state: publicState(currentUser) });
      return;
    }

    if (request.method === "GET" && path === "/api/paper/versions") {
      const versions = await listPaperVersions();
      sendJson(response, {
        ok: true,
        latest: versions[0] || "latest",
        versions: [
          { value: "latest", label: `Latest Paper${versions[0] ? ` (${versions[0]})` : ""}` },
          ...versions.map((version) => ({ value: version, label: `Paper ${version}` }))
        ]
      });
      return;
    }

    if (request.method === "GET" && path === "/api/export") {
      requireAdmin(currentUser);
      response.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-disposition": `attachment; filename="${slug(state.settings.panelName)}-backup.json"`
      });
      response.end(JSON.stringify(publicState(currentUser), null, 2));
      return;
    }

    if (request.method === "GET" && path === "/api/catalog/search") {
      const query = String(url.searchParams.get("query") || "").trim();
      if (!query) throw new Error("Search query required");
      const type = normalizeContentType(url.searchParams.get("type"));
      const loader = normalizeLoader(url.searchParams.get("loader"));
      const source = String(url.searchParams.get("source") || "all").toLowerCase();
      const gameVersion = String(url.searchParams.get("gameVersion") || "").trim();
      const limit = Math.min(24, Math.max(1, Number(url.searchParams.get("limit") || 12)));
      const searches = [];
      if (source === "all" || source === "modrinth") searches.push(searchModrinth({ query, type, loader, gameVersion, limit }));
      if (type === "plugin" && (source === "all" || source === "spiget")) searches.push(searchSpiget({ query, limit }));
      const settled = await Promise.allSettled(searches);
      const results = settled.flatMap((entry) => entry.status === "fulfilled" ? entry.value : []);
      const errors = settled.filter((entry) => entry.status === "rejected").map((entry) => entry.reason.message);
      sendJson(response, { ok: true, results: results.slice(0, limit * 2), errors });
      return;
    }

    if (request.method === "POST" && path === "/api/click") {
      state.clickProgress += 1;
      const target = Math.max(1, Number(state.settings.clickTarget));
      if (state.clickProgress >= target) {
        state.clickProgress -= target;
        state.coins += Number(state.settings.clickReward);
        addActivity(`Coin reward claimed: +${state.settings.clickReward} coins.`);
      }
      await persist();
      sendJson(response, { ok: true, state: publicState() });
      return;
    }

    if (request.method === "POST" && path === "/api/marketplace/server-limit") {
      const cost = 1000;
      if (Number(state.coins || 0) < cost) throw new Error("Not enough coins for server limit upgrade");
      state.coins -= cost;
      state.settings.maxServers = Number(state.settings.maxServers || 0) + 1;
      addActivity(`Marketplace purchase: +1 server limit for ${cost} coins.`);
      await persist();
      sendJson(response, { ok: true, cost, state: publicState() });
      return;
    }

    if (request.method === "POST" && path === "/api/marketplace/buy") {
      const body = await readBody(request);
      const item = marketplaceItems.find((entry) => entry.id === body.itemId);
      if (!item) throw new Error("Marketplace item not found");
      state.marketplacePurchases = state.marketplacePurchases || [];
      if (state.marketplacePurchases.includes(item.id)) throw new Error("Item already purchased");
      if (Number(state.coins || 0) < item.price) throw new Error("Not enough coins");
      state.coins -= item.price;
      state.marketplacePurchases.push(item.id);
      applyMarketplaceEffect(item);
      addActivity(`Marketplace purchase: ${item.name} for ${item.price} coins.`);
      await persist();
      sendJson(response, { ok: true, item, state: publicState(currentUser) });
      return;
    }

    if (request.method === "POST" && path === "/api/servers") {
      const body = await readBody(request);
      if (state.servers.length >= Number(state.settings.maxServers)) throw new Error("Server limit reached");
      if (state.coins < Number(state.settings.serverCost)) throw new Error("Not enough coins");
      const server = await createServerRecord({ ...body, ownerId: currentUser.id }, true);
      state.servers.unshift(server);
      state.selectedServerId = server.id;
      addActivity(`${server.name} created with ${server.provider} adapter.`);
      if (body.autoStart) await startServer(server);
      await persist();
      sendJson(response, { ok: true, state: publicState() });
      return;
    }

    const lifecycleMatch = path.match(/^\/api\/servers\/([^/]+)\/lifecycle$/);
    if (request.method === "POST" && lifecycleMatch) {
      const server = findServer(lifecycleMatch[1]);
      const body = await readBody(request);
      const action = String(body.action || "").trim();
      if (action === "delete") {
        await stopServer(server).catch(() => {});
        state.servers = state.servers.filter((item) => item.id !== server.id);
        state.players = state.players.filter((player) => player.serverId !== server.id);
        await rm(serverDir(server), { recursive: true, force: true });
        addActivity(`${server.name}: deleted.`);
        await persist();
        sendJson(response, { ok: true, state: publicState(currentUser) });
        return;
      }
      if (action === "suspend") {
        await stopServer(server).catch(() => {});
        server.status = "suspended";
        addLog(server, "Server suspended.");
      } else if (action === "resume") {
        if (server.status === "suspended") server.status = "stopped";
        addLog(server, "Server resumed.");
      } else {
        throw new Error("Invalid lifecycle action");
      }
      await persist();
      sendJson(response, { ok: true, state: publicState(currentUser) });
      return;
    }

    const powerMatch = path.match(/^\/api\/servers\/([^/]+)\/power$/);
    if (request.method === "POST" && powerMatch) {
      const server = findServer(powerMatch[1]);
      const body = await readBody(request);
      const action = body.action || "restart";
      if (action === "start") await startServer(server);
      if (action === "stop" || action === "kill") await stopServer(server, action === "kill");
      if (action === "restart") {
        await stopServer(server);
        await startServer(server);
      }
      addActivity(`${server.name}: ${action}.`);
      await persist();
      sendJson(response, { ok: true, state: publicState() });
      return;
    }

    const renewAdMatch = path.match(/^\/api\/servers\/([^/]+)\/renew\/ad$/);
    if (request.method === "POST" && renewAdMatch) {
      const server = findServer(renewAdMatch[1]);
      const body = await readBody(request);
      const adIndex = Number(body.adIndex);
      if (!Number.isInteger(adIndex) || adIndex < 0 || adIndex >= renewalAds.length) throw new Error("Invalid ad index");
      server.renewal = server.renewal || { watchedAds: [] };
      server.renewal.watchedAds = Array.from(new Set([...(server.renewal.watchedAds || []), adIndex]));
      addLog(server, `Renewal ad ${adIndex + 1}/${renewalAds.length} opened.`);
      await persist();
      sendJson(response, { ok: true, url: renewalAds[adIndex], progress: renewProgress(server), state: publicState(currentUser) });
      return;
    }

    const renewClaimMatch = path.match(/^\/api\/servers\/([^/]+)\/renew\/claim$/);
    if (request.method === "POST" && renewClaimMatch) {
      const server = findServer(renewClaimMatch[1]);
      const progress = renewProgress(server);
      if (!progress.complete) throw new Error("Open all 3 ads before renewal");
      const currentExpiry = Math.max(Date.now(), new Date(server.expiresAt || 0).getTime());
      server.expiresAt = new Date(currentExpiry + renewalBonusMs).toISOString();
      server.renewal = { watchedAds: [] };
      if (server.status === "expired") server.status = "stopped";
      addActivity(`${server.name}: renewed for 45 minutes.`);
      addLog(server, "Server renewed for 45 minutes after 3 ads.");
      await persist();
      sendJson(response, { ok: true, expiresAt: server.expiresAt, state: publicState(currentUser) });
      return;
    }

    const clearLogsMatch = path.match(/^\/api\/servers\/([^/]+)\/logs\/clear$/);
    if (request.method === "POST" && clearLogsMatch) {
      const server = findServer(clearLogsMatch[1]);
      server.console = [nowLine("Console history cleared.")];
      addActivity(`${server.name}: console history cleared.`);
      await persist();
      sendJson(response, { ok: true, state: publicState(currentUser) });
      return;
    }

    const optimizerMatch = path.match(/^\/api\/servers\/([^/]+)\/optimizer\/run$/);
    if (request.method === "POST" && optimizerMatch) {
      const server = findServer(optimizerMatch[1]);
      server.optimizer = buildOptimizerReport(server);
      addLog(server, `AI optimizer scan complete: score ${server.optimizer.score}/100.`);
      addActivity(`${server.name}: optimizer scan completed.`);
      await persist();
      sendJson(response, { ok: true, report: server.optimizer, state: publicState(currentUser) });
      return;
    }

    const performanceModeMatch = path.match(/^\/api\/servers\/([^/]+)\/performance-mode$/);
    if (request.method === "POST" && performanceModeMatch) {
      const server = findServer(performanceModeMatch[1]);
      const body = await readBody(request);
      await applyPerformanceMode(server, body.mode);
      await persist();
      sendJson(response, { ok: true, state: publicState(currentUser) });
      return;
    }

    const healthMatch = path.match(/^\/api\/servers\/([^/]+)\/health$/);
    if (request.method === "GET" && healthMatch) {
      const server = findServer(healthMatch[1]);
      sendJson(response, { ok: true, health: buildHealthReport(server) });
      return;
    }

    const ramAutoMatch = path.match(/^\/api\/servers\/([^/]+)\/ram-auto$/);
    if (request.method === "POST" && ramAutoMatch) {
      const server = findServer(ramAutoMatch[1]);
      const health = await applyRamAutoAllocator(server);
      await persist();
      sendJson(response, { ok: true, health, state: publicState(currentUser) });
      return;
    }

    const analyticsMatch = path.match(/^\/api\/servers\/([^/]+)\/analytics$/);
    if (request.method === "GET" && analyticsMatch) {
      const server = findServer(analyticsMatch[1]);
      sendJson(response, { ok: true, analytics: buildNetworkAnalytics(server) });
      return;
    }

    const autoHealMatch = path.match(/^\/api\/servers\/([^/]+)\/auto-heal$/);
    if (request.method === "POST" && autoHealMatch) {
      const server = findServer(autoHealMatch[1]);
      const body = await readBody(request);
      server.autoHeal = {
        ...(server.autoHeal || {}),
        enabled: Boolean(body.enabled),
        lastAction: Boolean(body.enabled) ? "Auto-heal enabled" : "Auto-heal paused"
      };
      addLog(server, server.autoHeal.lastAction);
      await persist();
      sendJson(response, { ok: true, state: publicState(currentUser) });
      return;
    }

    const commandMatch = path.match(/^\/api\/servers\/([^/]+)\/command$/);
    if (request.method === "POST" && commandMatch) {
      const server = findServer(commandMatch[1]);
      const body = await readBody(request);
      const command = String(body.command || "").trim();
      sendServerCommand(server, command);
      addActivity(`Command sent to ${server.name}: ${command}`);
      await persist();
      sendJson(response, { ok: true, state: publicState() });
      return;
    }

    const macroMatch = path.match(/^\/api\/servers\/([^/]+)\/macros$/);
    if (request.method === "POST" && macroMatch) {
      const server = findServer(macroMatch[1]);
      const body = await readBody(request);
      const macro = {
        id: uid("macro"),
        name: String(body.name || "Macro").trim(),
        command: String(body.command || "").trim()
      };
      if (!macro.command) throw new Error("Macro command required");
      server.commandMacros = server.commandMacros || [];
      server.commandMacros.push(macro);
      addLog(server, `Command macro saved: ${macro.name}`);
      await persist();
      sendJson(response, { ok: true, macro, state: publicState(currentUser) });
      return;
    }

    const macroRunMatch = path.match(/^\/api\/servers\/([^/]+)\/macros\/([^/]+)\/run$/);
    if (request.method === "POST" && macroRunMatch) {
      const server = findServer(macroRunMatch[1]);
      const macro = commandMacro(server, macroRunMatch[2]);
      if (!macro) throw new Error("Macro not found");
      sendServerCommand(server, macro.command);
      addActivity(`${server.name}: macro ${macro.name} ran.`);
      await persist();
      sendJson(response, { ok: true, state: publicState(currentUser) });
      return;
    }

    const macroDeleteMatch = path.match(/^\/api\/servers\/([^/]+)\/macros\/([^/]+)\/delete$/);
    if (request.method === "POST" && macroDeleteMatch) {
      const server = findServer(macroDeleteMatch[1]);
      server.commandMacros = (server.commandMacros || []).filter((macro) => macro.id !== macroDeleteMatch[2]);
      await persist();
      sendJson(response, { ok: true, state: publicState(currentUser) });
      return;
    }

    const identityMatch = path.match(/^\/api\/servers\/([^/]+)\/identity$/);
    if (request.method === "POST" && identityMatch) {
      const server = findServer(identityMatch[1]);
      const body = await readBody(request);
      server.motd = String(body.motd || server.motd || state.settings.motd).trim();
      if (body.iconDataUrl) {
        await writeServerIcon(server, body.iconDataUrl);
        server.icon = body.iconDataUrl;
      } else if (body.iconUrl) {
        server.icon = String(body.iconUrl).trim();
      }
      await ensureServerFiles(server);
      await refreshServerFileList(server);
      addLog(server, "Server icon and MOTD updated.");
      addActivity(`${server.name}: icon and MOTD updated.`);
      await persist();
      sendJson(response, { ok: true, state: publicState() });
      return;
    }

    const filesMatch = path.match(/^\/api\/servers\/([^/]+)\/files$/);
    if (request.method === "GET" && filesMatch) {
      const server = findServer(filesMatch[1]);
      const folderPath = cleanOptionalPath(url.searchParams.get("path"));
      const files = await listDirectory(server, folderPath);
      sendJson(response, { ok: true, path: folderPath, files });
      return;
    }

    const fileMatch = path.match(/^\/api\/servers\/([^/]+)\/file$/);
    if (request.method === "GET" && fileMatch) {
      const server = findServer(fileMatch[1]);
      const filePath = cleanRelativePath(url.searchParams.get("path"));
      const fullPath = safeServerPath(server, filePath);
      const fileStat = await stat(fullPath);
      if (fileStat.isDirectory()) throw new Error("Cannot open a folder as text");
      const content = await readFile(fullPath, "utf8");
      sendJson(response, { ok: true, path: filePath, content, size: fileStat.size });
      return;
    }

    if (request.method === "POST" && fileMatch) {
      const server = findServer(fileMatch[1]);
      const body = await readBody(request);
      const filePath = cleanRelativePath(body.path);
      const fullPath = safeServerPath(server, filePath);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, String(body.content ?? ""));
      await refreshServerFileList(server);
      addLog(server, `File saved: ${filePath}`);
      addActivity(`${server.name}: saved ${filePath}.`);
      await persist();
      sendJson(response, { ok: true, state: publicState() });
      return;
    }

    const folderMatch = path.match(/^\/api\/servers\/([^/]+)\/folder$/);
    if (request.method === "POST" && folderMatch) {
      const server = findServer(folderMatch[1]);
      const body = await readBody(request);
      const folderPath = cleanRelativePath(body.path);
      await mkdir(safeServerPath(server, folderPath), { recursive: true });
      await refreshServerFileList(server);
      addLog(server, `Folder created: ${folderPath}`);
      addActivity(`${server.name}: folder created ${folderPath}.`);
      await persist();
      sendJson(response, { ok: true, state: publicState() });
      return;
    }

    const uploadMatch = path.match(/^\/api\/servers\/([^/]+)\/upload$/);
    if (request.method === "POST" && uploadMatch) {
      const server = findServer(uploadMatch[1]);
      const body = await readBody(request);
      const targetPath = cleanOptionalPath(body.targetPath);
      const files = Array.isArray(body.files) ? body.files.slice(0, 120) : [];
      if (!files.length) throw new Error("No files selected");
      let totalBytes = 0;
      for (const file of files) {
        const filePath = cleanRelativePath(file.relativePath || file.name);
        const buffer = decodeDataUrl(file.dataUrl);
        totalBytes += buffer.length;
        if (totalBytes > 60 * 1024 * 1024) throw new Error("Upload batch must stay under 60 MB");
        const target = safeServerPath(server, targetPath === "." ? filePath : `${targetPath}/${filePath}`);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, buffer);
      }
      await refreshServerFileList(server);
      addLog(server, `Uploaded ${files.length} file${files.length === 1 ? "" : "s"} into ${targetPath}`);
      addActivity(`${server.name}: uploaded ${files.length} file${files.length === 1 ? "" : "s"}.`);
      await persist();
      sendJson(response, { ok: true, state: publicState() });
      return;
    }

    const chunkUploadMatch = path.match(/^\/api\/servers\/([^/]+)\/upload-chunk$/);
    if (request.method === "POST" && chunkUploadMatch) {
      const server = findServer(chunkUploadMatch[1]);
      const body = await readBody(request);
      const uploadId = slug(body.uploadId || body.name || "world-upload");
      const fileName = cleanRelativePath(body.name || "world.zip").split("/").pop();
      const index = Number(body.index || 0);
      const total = Number(body.total || 1);
      const targetPath = cleanOptionalPath(body.targetPath || ".");
      const chunk = decodeDataUrl(body.dataUrl);
      if (chunk.length > 8 * 1024 * 1024) throw new Error("Chunk must stay under 8 MB");
      const tempDir = join(serverDir(server), ".uploads", uploadId);
      await mkdir(tempDir, { recursive: true });
      await writeFile(join(tempDir, String(index).padStart(6, "0")), chunk);
      if (index + 1 >= total) {
        const finalPath = safeServerPath(server, targetPath === "." ? fileName : `${targetPath}/${fileName}`);
        await mkdir(dirname(finalPath), { recursive: true });
        const parts = [];
        for (let part = 0; part < total; part += 1) {
          parts.push(await readFile(join(tempDir, String(part).padStart(6, "0"))));
        }
        await writeFile(finalPath, Buffer.concat(parts));
        await rm(tempDir, { recursive: true, force: true });
        await refreshServerFileList(server);
        addLog(server, `Chunk upload completed: ${targetPath}/${fileName}`);
        await persist();
      }
      sendJson(response, { ok: true, complete: index + 1 >= total, state: publicState(currentUser) });
      return;
    }

    const zipListMatch = path.match(/^\/api\/servers\/([^/]+)\/zip$/);
    if (request.method === "GET" && zipListMatch) {
      const server = findServer(zipListMatch[1]);
      const { cleanPath, buffer } = await readZipBuffer(server, url.searchParams.get("path"));
      const dir = String(url.searchParams.get("dir") || "").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
      const entries = listZipDirectory(zipEntries(buffer), dir);
      sendJson(response, { ok: true, path: cleanPath, dir, entries });
      return;
    }

    const zipFileMatch = path.match(/^\/api\/servers\/([^/]+)\/zip\/file$/);
    if (request.method === "GET" && zipFileMatch) {
      const server = findServer(zipFileMatch[1]);
      const { cleanPath, buffer } = await readZipBuffer(server, url.searchParams.get("path"));
      const entryPath = cleanZipEntryPath(url.searchParams.get("entry"));
      const entry = zipEntries(buffer).find((item) => item.name === entryPath && !item.directory);
      if (!entry) throw new Error("Zip entry not found");
      if (entry.size > 2 * 1024 * 1024) throw new Error("Zip preview supports files under 2 MB");
      const content = readZipEntry(buffer, entry).toString("utf8");
      sendJson(response, { ok: true, path: cleanPath, entry: entryPath, content, size: entry.size });
      return;
    }

    const zipExtractMatch = path.match(/^\/api\/servers\/([^/]+)\/zip\/extract$/);
    if (request.method === "POST" && zipExtractMatch) {
      const server = findServer(zipExtractMatch[1]);
      const body = await readBody(request);
      const { cleanPath, buffer } = await readZipBuffer(server, body.path);
      const targetPath = cleanOptionalPath(body.targetPath || `${cleanPath.replace(/\.zip$/i, "")}-extracted`);
      const entryPrefix = String(body.entry || "").replaceAll("\\", "/").replace(/^\/+/, "");
      const entries = zipEntries(buffer).filter((entry) => !entry.directory && (!entryPrefix || entry.name === entryPrefix || entry.name.startsWith(entryPrefix)));
      if (!entries.length) throw new Error("No zip files found to extract");
      for (const entry of entries.slice(0, 500)) {
        const entryPath = cleanZipEntryPath(entry.name);
        const target = safeServerPath(server, targetPath === "." ? entryPath : `${targetPath}/${entryPath}`);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, readZipEntry(buffer, entry));
      }
      await refreshServerFileList(server);
      addLog(server, `Extracted ${entries.length} zip item${entries.length === 1 ? "" : "s"} from ${cleanPath}`);
      addActivity(`${server.name}: extracted ${cleanPath}.`);
      await persist();
      sendJson(response, { ok: true, state: publicState() });
      return;
    }

    const fileDeleteMatch = path.match(/^\/api\/servers\/([^/]+)\/file\/delete$/);
    if (request.method === "POST" && fileDeleteMatch) {
      const server = findServer(fileDeleteMatch[1]);
      const body = await readBody(request);
      const filePath = cleanRelativePath(body.path);
      await rm(safeServerPath(server, filePath), { recursive: true, force: true });
      await refreshServerFileList(server);
      addLog(server, `Deleted: ${filePath}`);
      addActivity(`${server.name}: deleted ${filePath}.`);
      await persist();
      sendJson(response, { ok: true, state: publicState() });
      return;
    }

    const fileRenameMatch = path.match(/^\/api\/servers\/([^/]+)\/file\/rename$/);
    if (request.method === "POST" && fileRenameMatch) {
      const server = findServer(fileRenameMatch[1]);
      const body = await readBody(request);
      const from = cleanRelativePath(body.from);
      const to = cleanRelativePath(body.to);
      const target = safeServerPath(server, to);
      await mkdir(dirname(target), { recursive: true });
      await rename(safeServerPath(server, from), target);
      await refreshServerFileList(server);
      addLog(server, `Renamed ${from} to ${to}`);
      addActivity(`${server.name}: renamed ${from}.`);
      await persist();
      sendJson(response, { ok: true, state: publicState() });
      return;
    }

    const settingsMatch = path.match(/^\/api\/servers\/([^/]+)\/settings$/);
    if (request.method === "POST" && settingsMatch) {
      const server = findServer(settingsMatch[1]);
      const body = await readBody(request);
      server.name = String(body.name || server.name).trim();
      server.motd = String(body.motd || server.motd || state.settings.motd).trim();
      server.ram = Number(body.ram || server.ram);
      server.cpu = Number(body.cpu || server.cpu);
      server.disk = Number(body.disk || server.disk);
      server.backupLimit = normalizeBackupLimit(body.backupLimit, server.backupLimit ?? 10);
      server.options = {
        ...server.options,
        slots: Number(body.slots || server.options.slots),
        gamemode: body.gamemode || server.options.gamemode,
        difficulty: body.difficulty || server.options.difficulty,
        whitelist: Boolean(body.whitelist),
        pvp: Boolean(body.pvp),
        commandBlocks: Boolean(body.commandBlocks),
        cracked: Boolean(body.cracked),
        fly: Boolean(body.fly),
        monsters: Boolean(body.monsters),
        animals: Boolean(body.animals),
        nether: Boolean(body.nether),
        spawnProtection: Number(body.spawnProtection ?? server.options.spawnProtection),
        timezone: body.timezone || server.options.timezone
      };
      server.startup.variables.SERVER_NAME = server.name;
      server.startup.variables.SERVER_MEMORY = String(server.ram * 1024);
      await ensureServerFiles(server);
      await refreshServerFileList(server);
      addLog(server, "Server settings updated from panel.");
      addActivity(`${server.name}: settings updated.`);
      await persist();
      sendJson(response, { ok: true, state: publicState() });
      return;
    }

    const startupMatch = path.match(/^\/api\/servers\/([^/]+)\/startup$/);
    if (request.method === "POST" && startupMatch) {
      const server = findServer(startupMatch[1]);
      const body = await readBody(request);
      const selectedPaperVersion = normalizePaperVersion(body.paperVersion || server.startup.variables.MC_VERSION || "latest");
      const previousPaperVersion = normalizePaperVersion(server.startup.variables.MC_VERSION || "latest");
      server.startup.command = String(body.command || server.startup.command).trim();
      server.startup.image = String(body.image || server.startup.image).trim();
      server.startup.variables = {
        ...server.startup.variables,
        ...parseVariables(body.variablesText),
        MC_VERSION: selectedPaperVersion
      };
      if (selectedPaperVersion !== previousPaperVersion) {
        delete server.startup.variables.PAPER_SELECTED;
        delete server.startup.variables.PAPER_VERSION;
        delete server.startup.variables.PAPER_BUILD;
        delete server.startup.variables.PAPER_JAR;
        delete server.startup.variables.JAR_TEMPLATE;
        delete server.startup.variables.JAR_SELECTED;
        delete server.startup.variables.JAR_VERSION;
        delete server.startup.variables.JAR_BUILD;
        delete server.startup.variables.JAR_FILE;
        addLog(server, `Minecraft version changed to ${selectedPaperVersion === "latest" ? "Latest stable" : selectedPaperVersion}. Next start will install the matching jar.`);
      }
      addLog(server, "Startup command and variables updated.");
      addActivity(`${server.name}: startup updated.`);
      await persist();
      sendJson(response, { ok: true, state: publicState() });
      return;
    }

    const networkMatch = path.match(/^\/api\/servers\/([^/]+)\/network$/);
    if (request.method === "POST" && networkMatch) {
      const server = findServer(networkMatch[1]);
      const body = await readBody(request);
      const port = String(body.port || "").trim();
      if (!/^\d{2,5}$/.test(port)) throw new Error("Valid port required");
      if (!server.ports.includes(port)) server.ports.push(port);
      if (body.primary) server.allocation = `127.0.0.1:${port}`;
      server.startup.variables.SERVER_PORT = primaryPort(server);
      await ensureServerFiles(server);
      addLog(server, `Port added: ${port}`);
      addActivity(`${server.name}: port ${port} added.`);
      await persist();
      sendJson(response, { ok: true, state: publicState() });
      return;
    }

    const domainMatch = path.match(/^\/api\/servers\/([^/]+)\/domain$/);
    if (request.method === "POST" && domainMatch) {
      const server = findServer(domainMatch[1]);
      const body = await readBody(request);
      const domain = String(body.domain || "").trim().toLowerCase();
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(domain)) throw new Error("Valid domain required");
      server.customDomain = {
        domain,
        target: serverAddress(server),
        srvName: `_minecraft._tcp.${domain}`,
        srvTarget: String(server.allocation || "").split(":")[0] || "127.0.0.1",
        srvPort: primaryPort(server),
        updatedAt: new Date().toISOString()
      };
      addLog(server, `Custom domain helper saved for ${domain}.`);
      addActivity(`${server.name}: custom domain ${domain} configured.`);
      await persist();
      sendJson(response, { ok: true, state: publicState(currentUser) });
      return;
    }

    const databaseMatch = path.match(/^\/api\/servers\/([^/]+)\/databases$/);
    if (request.method === "POST" && databaseMatch) {
      const server = findServer(databaseMatch[1]);
      const body = await readBody(request);
      const db = {
        id: uid("db"),
        name: String(body.name || `${slug(server.name).replaceAll("-", "_")}_db`).trim(),
        user: String(body.user || `${slug(server.name).replaceAll("-", "_")}_user`).trim(),
        host: String(body.host || "localhost").trim()
      };
      server.databases.push(db);
      addLog(server, `Database added: ${db.name}`);
      addActivity(`${server.name}: database ${db.name} added.`);
      await persist();
      sendJson(response, { ok: true, state: publicState() });
      return;
    }

    const scheduleMatch = path.match(/^\/api\/servers\/([^/]+)\/schedules$/);
    if (request.method === "POST" && scheduleMatch) {
      const server = findServer(scheduleMatch[1]);
      const body = await readBody(request);
      const schedule = {
        id: uid("sch"),
        name: String(body.name || "New schedule").trim(),
        cron: String(body.cron || "0 4 * * *").trim(),
        action: String(body.action || "restart").trim(),
        active: body.active !== false
      };
      server.schedules.push(schedule);
      addLog(server, `Schedule added: ${schedule.name}`);
      addActivity(`${server.name}: schedule ${schedule.name} added.`);
      await persist();
      sendJson(response, { ok: true, state: publicState() });
      return;
    }

    const subuserMatch = path.match(/^\/api\/servers\/([^/]+)\/subusers$/);
    if (request.method === "POST" && subuserMatch) {
      const server = findServer(subuserMatch[1]);
      const body = await readBody(request);
      const permissions = String(body.permissions || "Console, Files").split(",").map((item) => item.trim()).filter(Boolean);
      const subuser = {
        name: String(body.name || "staff").trim(),
        role: String(body.role || "Staff").trim(),
        permissions
      };
      server.subusers.push(subuser);
      addLog(server, `Subuser added: ${subuser.name}`);
      addActivity(`${server.name}: subuser ${subuser.name} added.`);
      await persist();
      sendJson(response, { ok: true, state: publicState() });
      return;
    }

    const serverPlayerMatch = path.match(/^\/api\/servers\/([^/]+)\/players$/);
    if (request.method === "POST" && serverPlayerMatch) {
      const server = findServer(serverPlayerMatch[1]);
      const body = await readBody(request);
      const player = {
        id: uid("p"),
        name: String(body.name || "").trim(),
        serverId: server.id,
        role: String(body.role || "Member").trim(),
        status: "offline",
        ping: 0,
        whitelisted: body.whitelisted !== false
      };
      if (!player.name) throw new Error("Player name required");
      state.players.push(player);
      await ensureServerFiles(server);
      addLog(server, `Player added: ${player.name}`);
      addActivity(`${server.name}: player ${player.name} added.`);
      await persist();
      sendJson(response, { ok: true, state: publicState() });
      return;
    }

    const removeMatch = path.match(/^\/api\/servers\/([^/]+)\/remove$/);
    if (request.method === "POST" && removeMatch) {
      const server = findServer(removeMatch[1]);
      const body = await readBody(request);
      if (body.type === "port") {
        server.ports = server.ports.filter((port) => port !== String(body.value));
        if (!server.ports.length) server.ports.push("25565");
        if (server.allocation.endsWith(`:${body.value}`)) server.allocation = `127.0.0.1:${server.ports[0]}`;
        server.startup.variables.SERVER_PORT = primaryPort(server);
        await ensureServerFiles(server);
      }
      if (body.type === "database") server.databases = server.databases.filter((item) => item.id !== body.id);
      if (body.type === "schedule") server.schedules = server.schedules.filter((item) => item.id !== body.id);
      if (body.type === "subuser") server.subusers = server.subusers.filter((item) => item.name !== body.name);
      addLog(server, `Removed ${body.type}: ${body.value || body.id || body.name}`);
      addActivity(`${server.name}: removed ${body.type}.`);
      await persist();
      sendJson(response, { ok: true, state: publicState() });
      return;
    }

    const backupMatch = path.match(/^\/api\/servers\/([^/]+)\/backup$/);
    if (request.method === "POST" && backupMatch) {
      const server = findServer(backupMatch[1]);
      const body = await readBody(request);
      const backup = await createBackup(server, body.name);
      addActivity(`Backup created for ${server.name}.`);
      await persist();
      sendJson(response, { ok: true, backup, state: publicState() });
      return;
    }

    const backupRestoreMatch = path.match(/^\/api\/servers\/([^/]+)\/backup\/restore$/);
    if (request.method === "POST" && backupRestoreMatch) {
      const server = findServer(backupRestoreMatch[1]);
      const body = await readBody(request);
      await restoreBackup(server, body.backupId);
      addActivity(`${server.name}: backup restored.`);
      await persist();
      sendJson(response, { ok: true, state: publicState(currentUser) });
      return;
    }

    const backupSettingsMatch = path.match(/^\/api\/servers\/([^/]+)\/backup\/settings$/);
    if (request.method === "POST" && backupSettingsMatch) {
      const server = findServer(backupSettingsMatch[1]);
      const body = await readBody(request);
      server.backupTargets = {
        local: true,
        googleDrive: Boolean(body.googleDrive),
        dropbox: Boolean(body.dropbox)
      };
      addLog(server, "Backup targets updated.");
      await persist();
      sendJson(response, { ok: true, state: publicState(currentUser) });
      return;
    }

    const installMatch = path.match(/^\/api\/servers\/([^/]+)\/install$/);
    if (request.method === "POST" && installMatch) {
      const server = findServer(installMatch[1]);
      const body = await readBody(request);
      const item = await installContent(server, body.type, body.itemId);
      addActivity(`${item.name} installed on ${server.name}.`);
      await persist();
      sendJson(response, { ok: true, item, state: publicState() });
      return;
    }

    const installExternalMatch = path.match(/^\/api\/servers\/([^/]+)\/install-external$/);
    if (request.method === "POST" && installExternalMatch) {
      const server = findServer(installExternalMatch[1]);
      const body = await readBody(request);
      const item = await installExternalContent(server, body);
      addActivity(`${item.name} installed from ${body.source} on ${server.name}.`);
      await persist();
      sendJson(response, { ok: true, item, state: publicState() });
      return;
    }

    const contentUploadMatch = path.match(/^\/api\/servers\/([^/]+)\/content-upload$/);
    if (request.method === "POST" && contentUploadMatch) {
      const server = findServer(contentUploadMatch[1]);
      const body = await readBody(request);
      const installed = await uploadContentFiles(server, body.type, Array.isArray(body.files) ? body.files : []);
      addActivity(`${server.name}: ${installed.length} ${normalizeContentType(body.type)} file${installed.length === 1 ? "" : "s"} uploaded.`);
      await persist();
      sendJson(response, { ok: true, installed, state: publicState(currentUser) });
      return;
    }

    const contentToggleMatch = path.match(/^\/api\/servers\/([^/]+)\/content\/toggle$/);
    if (request.method === "POST" && contentToggleMatch) {
      const server = findServer(contentToggleMatch[1]);
      const body = await readBody(request);
      await toggleContent(server, body.type, body.name, body.enabled !== false);
      await persist();
      sendJson(response, { ok: true, state: publicState(currentUser) });
      return;
    }

    const contentUpdateMatch = path.match(/^\/api\/servers\/([^/]+)\/content\/update$/);
    if (request.method === "POST" && contentUpdateMatch) {
      const server = findServer(contentUpdateMatch[1]);
      const body = await readBody(request);
      const name = await updateContent(server, body.type, body.name);
      addActivity(`${server.name}: update checked for ${name}.`);
      await persist();
      sendJson(response, { ok: true, state: publicState(currentUser) });
      return;
    }

    const contentUpdatesMatch = path.match(/^\/api\/servers\/([^/]+)\/content\/updates$/);
    if (request.method === "GET" && contentUpdatesMatch) {
      const server = findServer(contentUpdatesMatch[1]);
      const type = normalizeContentType(url.searchParams.get("type"));
      sendJson(response, { ok: true, updates: scanContentUpdates(server, type) });
      return;
    }

    const permissionsMatch = path.match(/^\/api\/servers\/([^/]+)\/permissions$/);
    if (request.method === "POST" && permissionsMatch) {
      const server = findServer(permissionsMatch[1]);
      const body = await readBody(request);
      const groups = Array.isArray(body.groups) ? body.groups : [];
      server.permissions = {
        groups: groups.map((group) => ({
          name: slug(group.name || "group"),
          permissions: String(group.permissions || "").split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean)
        })).filter((group) => group.name)
      };
      await writePermissionsFile(server);
      addLog(server, "Permissions manager saved LuckPerms-compatible file.");
      await persist();
      sendJson(response, { ok: true, state: publicState(currentUser) });
      return;
    }

    const worldMapMatch = path.match(/^\/api\/servers\/([^/]+)\/world-map$/);
    if (request.method === "GET" && worldMapMatch) {
      const server = findServer(worldMapMatch[1]);
      sendJson(response, { ok: true, map: await buildWorldMap(server) });
      return;
    }

    const shellMatch = path.match(/^\/api\/servers\/([^/]+)\/shell$/);
    if (request.method === "POST" && shellMatch) {
      requireAdmin(currentUser);
      const server = findServer(shellMatch[1]);
      const body = await readBody(request);
      const result = await runServerShell(server, body.command);
      addLog(server, `Web SSH command ran: ${body.command}`);
      await persist();
      sendJson(response, { ok: true, result, state: publicState(currentUser) });
      return;
    }

    const playerMatch = path.match(/^\/api\/players\/([^/]+)\/action$/);
    if (request.method === "POST" && playerMatch) {
      const body = await readBody(request);
      const player = state.players.find((item) => item.id === playerMatch[1]);
      if (!player) throw new Error("Player not found");
      const server = findServer(player.serverId);
      if (body.action === "delete") {
        state.players = state.players.filter((item) => item.id !== player.id);
        await ensureServerFiles(server);
        addLog(server, `Player removed: ${player.name}`);
        addActivity(`Player ${player.name} removed.`);
        await persist();
        sendJson(response, { ok: true, state: publicState() });
        return;
      }
      if (body.action === "op") player.role = player.role === "Operator" ? "Member" : "Operator";
      if (body.action === "whitelist") player.whitelisted = !player.whitelisted;
      if (body.action === "kick") player.status = "offline";
      if (body.action === "ban") {
        player.status = "banned";
        player.whitelisted = false;
      }
      await ensureServerFiles(server);
      addLog(server, `Player ${player.name}: ${body.action}`);
      addActivity(`Player ${player.name}: ${body.action}.`);
      await persist();
      sendJson(response, { ok: true, state: publicState() });
      return;
    }

    if (request.method === "POST" && path === "/api/broadcast") {
      const body = await readBody(request);
      const message = String(body.message || "").trim();
      if (!message) throw new Error("Broadcast message required");
      for (const server of state.servers) {
        const child = processes.get(server.id);
        if (child && child.stdin.writable) child.stdin.write(`say ${message}\n`);
        addLog(server, `Broadcast: ${message}`);
      }
      addActivity(`Broadcast sent: ${message}`);
      await persist();
      sendJson(response, { ok: true, state: publicState() });
      return;
    }

    if (request.method === "POST" && path === "/api/sync-players") {
      syncPlayers();
      for (const server of state.servers) await ensureServerFiles(server);
      await persist();
      sendJson(response, { ok: true, state: publicState() });
      return;
    }

    if (request.method === "POST" && path === "/api/admin/settings") {
      requireAdmin(currentUser);
      const body = await readBody(request);
      state.settings = {
        ...state.settings,
        panelName: String(body.panelName || state.settings.panelName).trim(),
        serverCost: Number(body.serverCost || state.settings.serverCost),
        maxServers: Number(body.maxServers || state.settings.maxServers),
        clickTarget: Number(body.clickTarget || state.settings.clickTarget),
        clickReward: Number(body.clickReward || state.settings.clickReward),
        motd: String(body.motd || state.settings.motd).trim(),
        providers: { ...state.settings.providers, ...(body.providers || {}) }
      };
      if (!Object.values(state.settings.providers).some(Boolean)) state.settings.providers.vps = true;
      addActivity("Admin settings saved.");
      await persist();
      sendJson(response, { ok: true, state: publicState(currentUser) });
      return;
    }

    if (request.method === "POST" && path === "/api/catalog") {
      requireAdmin(currentUser);
      const body = await readBody(request);
      const item = {
        id: uid(body.type === "mod" ? "mod" : "pl"),
        name: String(body.name || "").trim(),
        version: String(body.version || "1.0.0").trim(),
        description: String(body.description || "").trim(),
        icon: String(body.icon || (body.type === "mod" ? "code" : "package")).trim(),
        sourceUrl: String(body.sourceUrl || "").trim()
      };
      if (!item.name) throw new Error("Name required");
      if (body.type === "mod") state.modCatalog.unshift(item);
      else state.pluginCatalog.unshift(item);
      addActivity(`Catalog item added: ${item.name}.`);
      await persist();
      sendJson(response, { ok: true, state: publicState(currentUser) });
      return;
    }

    if (request.method === "POST" && path === "/api/reset") {
      const exits = [];
      for (const child of processes.values()) {
        exits.push(new Promise((resolve) => {
          child.once("exit", resolve);
          child.kill();
          setTimeout(resolve, 600);
        }));
      }
      await Promise.all(exits);
      processes.clear();
      await rm(dataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      await loadState();
      sendJson(response, { ok: true, state: publicState() });
      return;
    }

    sendError(response, new Error("API route not found"), 404);
  } catch (error) {
    sendError(response, error);
  }
}

function syncPlayers() {
  const server = state.servers.find((item) => item.id === state.selectedServerId) || state.servers[0];
  if (!server) return;
  const logText = (server.console || []).join("\n");
  const joined = Array.from(logText.matchAll(/\]:\s*([A-Za-z0-9_]{3,16}) joined the game/g)).map((match) => match[1]);
  const left = new Set(Array.from(logText.matchAll(/\]:\s*([A-Za-z0-9_]{3,16}) left the game/g)).map((match) => match[1]));
  for (const name of joined) {
    if (!state.players.some((player) => player.serverId === server.id && player.name === name)) {
      state.players.push({
        id: uid("p"),
        name,
        serverId: server.id,
        role: "Member",
        status: "online",
        ping: 0,
        whitelisted: true
      });
    }
  }
  state.players = state.players.map((player) => {
    if (player.serverId !== server.id) return player;
    if (player.status === "banned") return player;
    if (left.has(player.name)) return { ...player, status: "offline", ping: 0 };
    if (joined.includes(player.name) && server.status === "running") return { ...player, status: "online", ping: 0 };
    return { ...player, status: server.status === "running" ? player.status : "offline", ping: 0 };
  });
  addActivity(`${server.name}: players synced from console join/leave logs.`);
}

function resolveStatic(urlPath) {
  const cleanPath = decodeURIComponent(urlPath.split("?")[0]);
  const requested = cleanPath === "/" ? "/index.html" : cleanPath;
  const fullPath = normalize(join(root, requested));
  if (!fullPath.startsWith(root)) return null;
  return fullPath;
}

function serveStatic(request, response, path) {
  const fullPath = resolveStatic(path);
  if (!fullPath || !existsSync(fullPath) || statSync(fullPath).isDirectory()) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }
  response.writeHead(200, {
    "content-type": types[extname(fullPath)] || "application/octet-stream",
    "cache-control": "no-store"
  });
  createReadStream(fullPath).pipe(response);
}

await loadState();
runMaintenance();
setInterval(runMaintenance, 60 * 1000);

createServer((request, response) => {
  const url = new URL(request.url || "/", `http://${request.headers.host || "127.0.0.1"}`);
  if (url.pathname.startsWith("/api/")) {
    handleApi(request, response, url);
    return;
  }
  serveStatic(request, response, url.pathname);
}).listen(port, host, () => {
  const publicHost = host === "0.0.0.0" ? "127.0.0.1" : host;
  console.log(`
██╗  ██╗███████╗██████╗  ██████╗ ███╗   ██╗██████╗  █████╗ ███╗   ██╗███████╗██╗
██║  ██║██╔════╝██╔══██╗██╔═══██╗████╗  ██║██╔══██╗██╔══██╗████╗  ██║██╔════╝██║
███████║█████╗  ██████╔╝██║   ██║██╔██╗ ██║██████╔╝███████║██╔██╗ ██║█████╗  ██║
██╔══██║██╔══╝  ██╔══██╗██║   ██║██║╚██╗██║██╔═══╝ ██╔══██║██║╚██╗██║██╔══╝  ██║
██║  ██║███████╗██║  ██║╚██████╔╝██║ ╚████║██║     ██║  ██║██║ ╚████║███████╗███████╗
╚═╝  ╚═╝╚══════╝╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝     ╚═╝  ╚═╝╚═╝  ╚═══╝╚══════╝╚══════╝

                    Minecraft Server Management

                              🟢 RUNNING:- http://127.0.0.1:${port}
`);
});
