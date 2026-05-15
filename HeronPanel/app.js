const tokenKey = "heronpanel-token";

const providerCatalog = [
  { id: "local", name: "Local backend" },
  { id: "pterodactyl", name: "Pterodactyl" },
  { id: "codesandbox", name: "Codesandbox" },
  { id: "github", name: "GitHub" },
  { id: "vps", name: "Real VPS" }
];

const gameEggs = [
  "Minecraft Java Paper",
  "Minecraft Bedrock",
  "Forge Modded",
  "Fabric Modded",
  "Velocity Proxy",
  "Node.js Bot",
  "Python App"
];

let state = null;
let currentUser = null;
let activeTab = "console";
let searchResults = [];
let searchStatus = "Search Paper/Bukkit/Spigot plugins or Fabric/Forge mods.";
let fileBrowser = { path: ".", entries: [] };
let fileEditor = { path: "", content: "", loaded: false };
let zipViewer = { zipPath: "", dir: "", entries: [], previewEntry: "", previewContent: "" };
let paperVersions = [
  { value: "latest", label: "Latest Paper" },
  { value: "1.21.11", label: "Paper 1.21.11" },
  { value: "1.21.10", label: "Paper 1.21.10" },
  { value: "1.21.8", label: "Paper 1.21.8" },
  { value: "1.21.4", label: "Paper 1.21.4" },
  { value: "1.20.6", label: "Paper 1.20.6" },
  { value: "1.20.4", label: "Paper 1.20.4" },
  { value: "1.20.1", label: "Paper 1.20.1" },
  { value: "1.19.4", label: "Paper 1.19.4" },
  { value: "1.19.2", label: "Paper 1.19.2" },
  { value: "1.19", label: "Paper 1.19" }
];
let paperVersionsPromise = null;

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => Array.from(scope.querySelectorAll(selector));
const pageMode = document.body.dataset.page || ($("#dashboardContent") ? "dashboard" : "panel");

function icon(name, className = "button-icon") {
  return `<svg class="${className}" aria-hidden="true"><use href="#i-${name}"></use></svg>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function checked(value) {
  return value ? "checked" : "";
}

function selected(value, current) {
  return String(value) === String(current) ? "selected" : "";
}

function canUseAdmin() {
  return currentUser?.role === "admin";
}

function serverIcon(server) {
  return server?.icon || "assets/brand-logo.png";
}

function selectedServer() {
  const id = new URLSearchParams(location.search).get("server") || state?.selectedServerId;
  return state?.servers.find((server) => server.id === id) || state?.servers[0] || null;
}

function variablesText(vars) {
  return Object.entries(vars || {}).map(([key, value]) => `${key}=${value}`).join("\n");
}

function selectedPaperVersion(server) {
  return server?.startup?.variables?.MC_VERSION || "latest";
}

function paperVersionOptions(selected = "latest") {
  const hasSelected = paperVersions.some((version) => version.value === selected);
  const options = hasSelected ? paperVersions : [{ value: selected, label: `Paper ${selected}` }, ...paperVersions];
  return options.map((version) => `<option value="${escapeHtml(version.value)}" ${selectedVersion(version.value, selected)}>${escapeHtml(version.label)}</option>`).join("");
}

function selectedVersion(value, current) {
  return String(value) === String(current) ? "selected" : "";
}

function fillPaperVersionSelect(select) {
  const selected = select.value || select.dataset.selected || "latest";
  select.innerHTML = paperVersionOptions(selected);
  select.value = paperVersions.some((version) => version.value === selected) ? selected : "latest";
}

async function loadPaperVersions() {
  if (paperVersionsPromise) return paperVersionsPromise;
  paperVersionsPromise = api("/api/paper/versions")
    .then((payload) => {
      if (Array.isArray(payload.versions) && payload.versions.length) {
        paperVersions = payload.versions;
        $$(".paper-version-select").forEach(fillPaperVersionSelect);
      }
    })
    .catch(() => {})
    .finally(() => {
      paperVersionsPromise = null;
    });
  return paperVersionsPromise;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file) return resolve("");
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Unable to read icon file"));
    reader.readAsDataURL(file);
  });
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function cleanUiPath(value) {
  const clean = String(value || ".").replaceAll("\\", "/").replace(/^\/+|\/+$/g, "");
  return clean && clean !== "." ? clean : ".";
}

function parentUiPath(value) {
  const clean = cleanUiPath(value);
  if (clean === ".") return ".";
  const parts = clean.split("/").filter(Boolean);
  parts.pop();
  return parts.length ? parts.join("/") : ".";
}

function joinUiPath(base, name) {
  const cleanBase = cleanUiPath(base);
  const cleanName = String(name || "").replaceAll("\\", "/").replace(/^\/+/, "");
  return cleanBase === "." ? cleanName : `${cleanBase}/${cleanName}`;
}

function filesInCurrentFolder(server) {
  const path = cleanUiPath(fileBrowser.path);
  if (fileBrowser.entries.length) return fileBrowser.entries;
  const prefix = path === "." ? "" : `${path}/`;
  const map = new Map();
  for (const file of server.files || []) {
    if (!file.name.startsWith(prefix)) continue;
    const rest = file.name.slice(prefix.length);
    if (!rest) continue;
    const parts = rest.split("/").filter(Boolean);
    if (!parts.length) continue;
    const label = parts[0];
    const isFolder = parts.length > 1 || file.type === "Folder";
    const name = `${prefix}${label}${isFolder ? "/" : ""}`;
    if (!map.has(name)) {
      map.set(name, { ...file, name, label, type: isFolder ? "Folder" : file.type });
    }
  }
  return Array.from(map.values()).sort((a, b) => {
    if (a.type === "Folder" && b.type !== "Folder") return -1;
    if (a.type !== "Folder" && b.type === "Folder") return 1;
    return (a.label || a.name).localeCompare(b.label || b.name);
  });
}

function isZipFile(file) {
  return String(file.name || "").toLowerCase().endsWith(".zip");
}

function setButtonBusy(button, label) {
  if (!button) return () => {};
  const html = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="button-spinner"></span>${escapeHtml(label)}`;
  return () => {
    button.disabled = false;
    button.innerHTML = html;
  };
}

async function api(path, options = {}) {
  const headers = options.body ? { "content-type": "application/json" } : {};
  const token = localStorage.getItem(tokenKey);
  if (token) headers.authorization = `Bearer ${token}`;
  const response = await fetch(path, {
    method: options.method || "GET",
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();
  if (!response.ok || !payload.ok) {
    if (response.status === 401) showAuth();
    throw new Error(payload.error || "Request failed");
  }
  if (payload.state) state = payload.state;
  if (payload.user) currentUser = payload.user;
  return payload;
}

function applyTheme() {
  if (!state) return;
  $$("[data-bind='panelName']").forEach((node) => {
    node.textContent = state.settings.panelName;
  });
  const accountButton = $("#accountSettingsBtn");
  if (accountButton && currentUser) {
    accountButton.title = `Account settings: ${currentUser.username}`;
  }
  const adminButton = $("#adminPanelBtn");
  if (adminButton) {
    adminButton.classList.toggle("hidden", !canUseAdmin());
  }
  const suffix = pageMode === "marketplace" ? "Marketplace" : pageMode === "dashboard" ? "Dashboard" : "Panel";
  document.title = `${state.settings.panelName} ${suffix}`;
}

function showAuth() {
  $("#authScreen").classList.remove("hidden");
  $("#panelShell")?.classList.add("hidden");
  $("#dashboardShell")?.classList.add("hidden");
  $("#marketplaceShell")?.classList.add("hidden");
}

function showPanel() {
  $("#authScreen").classList.add("hidden");
  if (pageMode === "dashboard") {
    $("#dashboardShell")?.classList.remove("hidden");
  } else if (pageMode === "marketplace") {
    $("#marketplaceShell")?.classList.remove("hidden");
  } else {
    $("#panelShell")?.classList.remove("hidden");
  }
}

async function refresh() {
  const payload = await api("/api/state");
  state = payload.state;
  if (payload.user) currentUser = payload.user;
  applyTheme();
  showPanel();
  render();
}

function openServer(id) {
  if (pageMode !== "panel") {
    location.href = `panel.html?server=${encodeURIComponent(id)}#console`;
    return;
  }
  fileBrowser = { path: ".", entries: [] };
  fileEditor = { path: "", content: "", loaded: false };
  zipViewer = { zipPath: "", dir: "", entries: [], previewEntry: "", previewContent: "" };
  history.pushState(null, "", `panel.html?server=${encodeURIComponent(id)}#${activeTab}`);
  state.selectedServerId = id;
  render();
}

function setTab(tab) {
  activeTab = tab;
  history.replaceState(null, "", `panel.html?server=${encodeURIComponent(selectedServer()?.id || "")}#${tab}`);
  render();
}

function render() {
  if (!state) return;
  if (pageMode === "dashboard") {
    renderDashboard();
    fillCreateOptions();
    return;
  }
  if (pageMode === "marketplace") {
    renderMarketplace();
    fillCreateOptions();
    return;
  }
  const hashTab = location.hash.replace("#", "");
  if (hashTab) activeTab = hashTab;
  renderServerPicker(false);
  renderTabs();
  renderContent();
  fillCreateOptions();
}

function renderMarketplace() {
  const content = $("#marketplaceContent");
  if (!content) return;
  content.innerHTML = `
    <section class="dashboard-hero marketplace-hero">
      <div>
        <p class="eyebrow">Marketplace</p>
        <h1>Upgrade store</h1>
      </div>
      <div class="dashboard-wallet">
        <span>${icon("coin")}Coins</span>
        <strong>${Number(state.coins || 0).toLocaleString("en-IN")}</strong>
      </div>
    </section>
    <section class="dashboard-section marketplace-section">
      <div class="section-header">
        <div>
          <p class="eyebrow">Server upgrades</p>
          <h2>Limits and capacity</h2>
        </div>
        <span class="status-pill">${state.servers.length}/${state.settings.maxServers} servers</span>
      </div>
      <div class="marketplace-grid">
        <article class="marketplace-card">
          <div class="marketplace-offer">
            <div class="market-icon">${icon("server", "catalog-svg")}</div>
            <div>
              <strong>Server limit upgrade</strong>
              <p class="muted">Spend 1000 coins to increase your max server limit from ${state.settings.maxServers} to ${Number(state.settings.maxServers) + 1}.</p>
            </div>
          </div>
          <div class="marketplace-buy-row">
            <span class="status-pill">${icon("coin")}1000</span>
            <button class="primary-button" data-action="buy-server-limit" type="button" ${Number(state.coins || 0) < 1000 ? "disabled" : ""}>${icon("coin")}Buy upgrade</button>
          </div>
        </article>
      </div>
    </section>
  `;
}

function renderDashboard() {
  const content = $("#dashboardContent");
  if (!content) return;
  const running = state.servers.filter((server) => server.status === "running").length;
  const clickTarget = Math.max(1, Number(state.settings.clickTarget || 100));
  const clickProgress = Math.min(100, Math.round((Number(state.clickProgress || 0) / clickTarget) * 100));
  content.innerHTML = `
    <section class="dashboard-hero">
      <div>
        <p class="eyebrow">Main dashboard</p>
        <h1>Servers, coins, and quick access.</h1>
      </div>
      <div class="dashboard-wallet">
        <span>${icon("coin")}Coins</span>
        <strong>${Number(state.coins || 0).toLocaleString("en-IN")}</strong>
      </div>
    </section>
    <section class="dashboard-strip">
      ${dashboardStat("Servers", state.servers.length, "server")}
      ${dashboardStat("Running", running, "activity")}
      ${dashboardStat("Cost", `${state.settings.serverCost} coins`, "coin")}
      ${dashboardStat("Limit", `${state.servers.length}/${state.settings.maxServers}`, "layer")}
    </section>
    <section class="dashboard-main-grid">
      <article class="panel-card">
        <div class="section-header">
          <div>
            <p class="eyebrow">Your servers</p>
            <h2>Open control panel</h2>
          </div>
          <button class="primary-button" data-action="open-create" type="button">${icon("plus")}Create</button>
        </div>
        <div class="server-list compact-list">
          ${state.servers.map(renderDashboardServer).join("") || `<div class="empty-state compact-empty"><h2>No server yet</h2><p class="muted">Create one from the button above.</p></div>`}
        </div>
      </article>
      <aside class="dashboard-side">
        <article class="panel-card earn-card compact-earn">
          <div>
            <p class="eyebrow">Earn coins</p>
            <h2>${state.clickProgress}/${clickTarget} clicks</h2>
            <p class="muted">${state.settings.clickReward} coins reward after target.</p>
          </div>
          <div class="progress-bar"><span style="--value:${clickProgress}%"></span></div>
          <button class="ghost-button wide" data-action="click-earn" type="button">${icon("coin")}Click to earn</button>
        </article>
        <article class="panel-card">
          <div class="section-header compact"><h2>Recent activity</h2></div>
          <div class="activity-feed compact-activity">
            ${(state.activity || []).slice(0, 6).map((item) => `<div class="activity-item">${escapeHtml(item)}</div>`).join("") || `<div class="activity-item">No activity yet.</div>`}
          </div>
        </article>
      </aside>
    </section>
  `;
}

function dashboardStat(label, value, iconName) {
  return `
    <div class="dashboard-stat">
      ${icon(iconName)}
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderDashboardServer(server) {
  return `
    <div class="server-row dashboard-server-row">
      <img class="server-icon" src="${escapeHtml(serverIcon(server))}" alt="">
      <div>
        <h3>${escapeHtml(server.name)}</h3>
        <div class="server-meta">
          <span>${escapeHtml(server.egg)}</span>
          <span>${escapeHtml(server.allocation)}</span>
          <span>${escapeHtml(server.status)}</span>
        </div>
      </div>
      <button class="primary-button" type="button" data-action="open-server" data-id="${escapeHtml(server.id)}">${icon("server")}Open</button>
    </div>
  `;
}

function renderTabs() {
  $$(".tab-link").forEach((button) => {
    button.classList.toggle("active", button.dataset.tab === activeTab);
  });
}

function renderServerPicker(force = false) {
  const picker = $("#serverPicker");
  if (!force && selectedServer()) {
    picker.classList.add("hidden");
    return;
  }
  picker.classList.remove("hidden");
  picker.innerHTML = `
    <div class="section-header">
      <div>
        <p class="eyebrow">Servers</p>
        <h2>Choose a server to control</h2>
      </div>
      <button class="primary-button" id="pickerCreateBtn" type="button">${icon("plus")}Create server</button>
    </div>
    <div class="server-list">
      ${state.servers.map(renderServerCard).join("") || `<div class="empty-state"><h2>No servers</h2><p class="muted">Create your first server.</p></div>`}
    </div>
  `;
}

function renderServerCard(server) {
  return `
    <div class="server-row">
      <img class="server-icon" src="${escapeHtml(serverIcon(server))}" alt="">
      <div>
        <h3>${escapeHtml(server.name)}</h3>
        <div class="server-meta">
          <span>${escapeHtml(server.egg)}</span>
          <span>${escapeHtml(server.allocation)}</span>
          <span>${escapeHtml(server.status)}</span>
        </div>
      </div>
      <button class="primary-button" type="button" data-action="open-server" data-id="${escapeHtml(server.id)}">${icon("server")}Open</button>
    </div>
  `;
}

function renderContent() {
  const server = selectedServer();
  const content = $("#panelContent");
  if (!server) {
    content.innerHTML = "";
    renderServerPicker(true);
    return;
  }
  $("#serverPicker").classList.add("hidden");
  const renderers = {
    console: renderConsole,
    files: renderFiles,
    databases: renderDatabases,
    schedules: renderSchedules,
    subusers: renderUsers,
    backups: renderBackups,
    network: renderNetwork,
    startup: renderStartup,
    settings: renderSettings,
    plugins: () => renderInstaller("plugin"),
    mods: () => renderInstaller("mod"),
    players: renderPlayers
  };
  content.innerHTML = (renderers[activeTab] || renderConsole)(server);
}

function renderConsole(server) {
  const ramPct = Math.min(100, Math.round((server.ram / 16) * 100));
  const cpuPct = Math.min(100, Math.round(server.cpu / 4));
  return `
    <div class="ptero-console-grid">
      <aside class="ptero-side">
        <article class="ptero-card">
          <div class="ptero-card-head">${icon("server")} ${escapeHtml(server.name)}</div>
          <div class="server-status-line"><span class="dot ${server.status === "running" ? "live" : ""}"></span>${escapeHtml(server.status)}</div>
          <div class="stat-line address-line" title="${escapeHtml(server.allocation)}">${icon("network")} ${escapeHtml(server.allocation)}</div>
          <div class="stat-line">${icon("code")} Paper ${escapeHtml(selectedPaperVersion(server) === "latest" ? "Latest" : selectedPaperVersion(server))}</div>
          <div class="stat-line">${icon("activity")} ${server.cpu}% CPU limit</div>
          <div class="stat-line">${icon("server")} ${server.ram * 1024} MB RAM</div>
          <div class="stat-line">${icon("folder")} ${server.disk} GB disk</div>
        </article>
        <article class="ptero-card power-card">
          <button class="ghost-button" data-action="power" data-id="${escapeHtml(server.id)}" data-power="start">${icon("play")}Start</button>
          <button class="ghost-button" data-action="power" data-id="${escapeHtml(server.id)}" data-power="restart">${icon("restart")}Restart</button>
          <button class="danger-button" data-action="power" data-id="${escapeHtml(server.id)}" data-power="stop">${icon("stop")}Stop</button>
        </article>
      </aside>
      <section class="console-main">
        <div class="console-box ptero-console">
          ${server.console.map((line) => `<div class="console-line">${escapeHtml(line)}</div>`).join("")}
        </div>
        <form class="command-row" data-command-form data-id="${escapeHtml(server.id)}">
          <input name="command" placeholder="say Hello players">
          <button class="primary-button" type="submit">${icon("send")}Send</button>
        </form>
      </section>
    </div>
    <div class="chart-grid">
      ${chartCard("Memory Usage", "MB", ramPct)}
      ${chartCard("CPU Usage", "%", cpuPct)}
    </div>
  `;
}

function chartCard(title, unit, value) {
  return `
    <article class="chart-card">
      <div class="ptero-card-head">${icon("activity")} ${title}</div>
      <div class="fake-chart">
        <span style="--value:${value}%"></span>
        <small>${value}${unit}</small>
      </div>
    </article>
  `;
}

function renderFiles(server) {
  const entries = filesInCurrentFolder(server);
  const currentPath = cleanUiPath(fileBrowser.path);
  return `
    <div class="control-grid">
      <form class="stack-form control-panel" data-file-save-form data-id="${escapeHtml(server.id)}">
        <div class="section-header compact"><h2>File Editor</h2><button class="primary-button" type="submit" data-save-file-button>${icon("folder")}Save</button></div>
        <label>Path<input name="path" value="${escapeHtml(fileEditor.path)}" placeholder="Click Edit on a file"></label>
        <label>Content<textarea name="content" rows="12" placeholder="File content opens here">${escapeHtml(fileEditor.content)}</textarea></label>
      </form>
      <div class="file-toolbox">
        <form class="stack-form control-panel" data-folder-form data-id="${escapeHtml(server.id)}">
          <h2>Create Folder</h2>
          <label>Path<input name="path" placeholder="${escapeHtml(joinUiPath(currentPath, "new-folder"))}"></label>
          <button class="ghost-button" type="submit">${icon("plus")}Create</button>
        </form>
        <form class="stack-form control-panel" data-upload-form data-id="${escapeHtml(server.id)}">
          <h2>Upload</h2>
          <label>Target folder<input name="targetPath" value="${escapeHtml(currentPath)}"></label>
          <label>Files<input name="files" type="file" multiple></label>
          <label>Folder<input name="folderFiles" type="file" webkitdirectory multiple></label>
          <button class="primary-button" type="submit" data-upload-button>${icon("folder")}Upload</button>
        </form>
      </div>
    </div>
    <div class="file-browser-head">
      <div>
        <p class="eyebrow">Current folder</p>
        <h2>/${escapeHtml(currentPath === "." ? "" : currentPath)}</h2>
      </div>
      <div class="row-actions">
        <button class="mini-button" data-action="folder-open" data-id="${escapeHtml(server.id)}" data-path=".">${icon("server")}Root</button>
        <button class="mini-button" data-action="folder-open" data-id="${escapeHtml(server.id)}" data-path="${escapeHtml(parentUiPath(currentPath))}" ${currentPath === "." ? "disabled" : ""}>${icon("restart")}Up</button>
      </div>
    </div>
    <div class="file-list">
      ${entries.map((file) => `
        <div class="file-item">
          <span>${escapeHtml(file.label || file.name)} <small class="muted">${escapeHtml(file.type)}</small></span>
          <div class="row-actions">
            ${file.type === "Folder" ? `<button class="mini-button" data-action="folder-open" data-id="${escapeHtml(server.id)}" data-path="${escapeHtml(file.name.replace(/\/$/, ""))}">${icon("folder")}Open</button>` : ""}
            ${isZipFile(file) ? `<button class="mini-button" data-action="zip-open" data-id="${escapeHtml(server.id)}" data-path="${escapeHtml(file.name)}">${icon("layer")}Open ZIP</button><button class="mini-button" data-action="zip-extract" data-id="${escapeHtml(server.id)}" data-path="${escapeHtml(file.name)}">${icon("backup")}Extract</button>` : ""}
            ${file.type === "Folder" ? "" : `<button class="mini-button" data-action="file-load" data-id="${escapeHtml(server.id)}" data-path="${escapeHtml(file.name)}">${icon("code")}Edit</button>`}
            <button class="mini-button" data-action="file-delete" data-id="${escapeHtml(server.id)}" data-path="${escapeHtml(file.name.replace(/\/$/, ""))}">${icon("ban")}Delete</button>
            <span class="muted">${escapeHtml(file.size)}</span>
          </div>
        </div>
      `).join("") || `<div class="file-item"><span>This folder is empty</span><span class="muted">empty</span></div>`}
    </div>
    ${renderZipViewer(server)}
  `;
}

function renderZipViewer(server) {
  if (!zipViewer.zipPath) return "";
  const dir = cleanUiPath(zipViewer.dir || ".");
  return `
    <article class="panel-card zip-viewer">
      <div class="section-header">
        <div>
          <p class="eyebrow">ZIP Browser</p>
          <h2>${escapeHtml(zipViewer.zipPath)} ${dir === "." ? "" : `/ ${escapeHtml(dir)}`}</h2>
        </div>
        <div class="row-actions">
          <button class="mini-button" data-action="zip-open" data-id="${escapeHtml(server.id)}" data-path="${escapeHtml(zipViewer.zipPath)}" data-dir="${escapeHtml(parentUiPath(dir))}" ${dir === "." ? "disabled" : ""}>${icon("restart")}Up</button>
          <button class="mini-button" data-action="zip-extract" data-id="${escapeHtml(server.id)}" data-path="${escapeHtml(zipViewer.zipPath)}">${icon("backup")}Extract all</button>
          <button class="mini-button" data-action="zip-close">${icon("ban")}Close</button>
        </div>
      </div>
      <div class="file-list">
        ${zipViewer.entries.map((entry) => `
          <div class="file-item">
            <span>${escapeHtml(entry.label || entry.name)} <small class="muted">${escapeHtml(entry.type)}</small></span>
            <div class="row-actions">
              ${entry.type === "Folder" ? `<button class="mini-button" data-action="zip-open" data-id="${escapeHtml(server.id)}" data-path="${escapeHtml(zipViewer.zipPath)}" data-dir="${escapeHtml(entry.name.replace(/\/$/, ""))}">${icon("folder")}Open</button>` : `<button class="mini-button" data-action="zip-preview" data-id="${escapeHtml(server.id)}" data-path="${escapeHtml(zipViewer.zipPath)}" data-entry="${escapeHtml(entry.name)}">${icon("code")}Preview</button><button class="mini-button" data-action="zip-extract" data-id="${escapeHtml(server.id)}" data-path="${escapeHtml(zipViewer.zipPath)}" data-entry="${escapeHtml(entry.name)}">${icon("backup")}Extract</button>`}
              <span class="muted">${escapeHtml(entry.size)}</span>
            </div>
          </div>
        `).join("") || `<div class="file-item"><span>No zip entries</span><span class="muted">empty</span></div>`}
      </div>
      ${zipViewer.previewEntry ? `<div class="zip-preview"><div class="section-header compact"><h2>${escapeHtml(zipViewer.previewEntry)}</h2></div><pre>${escapeHtml(zipViewer.previewContent)}</pre></div>` : ""}
    </article>
  `;
}

function renderSettings(server) {
  return `
    <form class="stack-form control-panel identity-panel" data-identity-form data-id="${escapeHtml(server.id)}">
      <div class="section-header compact"><h2>Server Icon and MOTD</h2><button class="primary-button" type="submit">${icon("server")}Save identity</button></div>
      <div class="identity-grid">
        <img class="server-icon xl" src="${escapeHtml(serverIcon(server))}" alt="">
        <div class="stack-form">
          <label>Upload PNG icon<input name="iconFile" type="file" accept="image/png"></label>
          <label>Icon URL<input name="iconUrl" value="${server.icon && !server.icon.startsWith("data:") ? escapeHtml(server.icon) : ""}"></label>
        </div>
      </div>
      <label>Custom MOTD<textarea name="motd" rows="3">${escapeHtml(server.motd || state.settings.motd)}</textarea></label>
    </form>
    <form class="stack-form control-panel" data-server-settings-form data-id="${escapeHtml(server.id)}">
      <div class="section-header compact"><h2>Server Settings</h2><button class="primary-button" type="submit">${icon("settings")}Save</button></div>
      <div class="form-grid">
        <label>Name<input name="name" value="${escapeHtml(server.name)}"></label>
        <label>MOTD<input name="motd" value="${escapeHtml(server.motd || state.settings.motd)}"></label>
      </div>
      <div class="form-grid">
        <label>RAM GB<input name="ram" type="number" value="${server.ram}"></label>
        <label>CPU %<input name="cpu" type="number" value="${server.cpu}"></label>
      </div>
      <div class="form-grid">
        <label>Disk GB<input name="disk" type="number" value="${server.disk}"></label>
        <label>Slots<input name="slots" type="number" value="${server.options?.slots || 60}"></label>
      </div>
      <div class="form-grid">
        <label>Gamemode<select name="gamemode"><option ${selected("survival", server.options?.gamemode)}>survival</option><option ${selected("creative", server.options?.gamemode)}>creative</option><option ${selected("adventure", server.options?.gamemode)}>adventure</option></select></label>
        <label>Difficulty<select name="difficulty"><option ${selected("peaceful", server.options?.difficulty)}>peaceful</option><option ${selected("easy", server.options?.difficulty)}>easy</option><option ${selected("normal", server.options?.difficulty)}>normal</option><option ${selected("hard", server.options?.difficulty)}>hard</option></select></label>
      </div>
      <div class="form-grid">
        <label>Spawn protection<input name="spawnProtection" type="number" value="${server.options?.spawnProtection ?? 16}"></label>
        <label>Timezone<input name="timezone" value="${escapeHtml(server.options?.timezone || "Asia/Kolkata")}"></label>
      </div>
      <div class="toggle-grid">
        ${["whitelist", "pvp", "commandBlocks", "cracked", "fly", "monsters", "animals", "nether"].map((key) => `<label class="checkbox-row"><input name="${key}" type="checkbox" ${checked(server.options?.[key])}> ${key}</label>`).join("")}
      </div>
    </form>
  `;
}

function renderNetwork(server) {
  return `
    <form class="stack-form control-panel" data-network-form data-id="${escapeHtml(server.id)}">
      <div class="section-header compact"><h2>Network</h2><button class="primary-button" type="submit">${icon("network")}Add port</button></div>
      <div class="form-grid"><label>Port<input name="port" type="number" placeholder="25566"></label><label class="checkbox-row"><input name="primary" type="checkbox"> Set primary</label></div>
    </form>
    <div class="settings-list">
      <div class="setting-item"><span>Primary allocation</span><strong>${escapeHtml(server.allocation)}</strong></div>
      ${server.ports.map((port) => `<div class="setting-item"><span>Port</span><div class="row-actions"><strong>${escapeHtml(port)}</strong><button class="mini-button" data-action="remove-resource" data-id="${escapeHtml(server.id)}" data-type="port" data-value="${escapeHtml(port)}">${icon("ban")}Remove</button></div></div>`).join("")}
    </div>
  `;
}

function renderDatabases(server) {
  return `
    <form class="stack-form control-panel" data-database-form data-id="${escapeHtml(server.id)}">
      <div class="section-header compact"><h2>Databases</h2><button class="primary-button" type="submit">${icon("database")}Add</button></div>
      <div class="form-grid"><label>Name<input name="name"></label><label>User<input name="user"></label></div>
      <label>Host<input name="host" value="localhost"></label>
    </form>
    <div class="settings-list">${server.databases.map((db) => `<div class="setting-item"><span>${escapeHtml(db.name)} <small class="muted">${escapeHtml(db.host)}</small></span><div class="row-actions"><strong>${escapeHtml(db.user)}</strong><button class="mini-button" data-action="remove-resource" data-id="${escapeHtml(server.id)}" data-type="database" data-resource-id="${escapeHtml(db.id)}">${icon("ban")}Remove</button></div></div>`).join("")}</div>
  `;
}

function renderSchedules(server) {
  return `
    <form class="stack-form control-panel" data-schedule-form data-id="${escapeHtml(server.id)}">
      <div class="section-header compact"><h2>Schedules</h2><button class="primary-button" type="submit">${icon("calendar")}Add</button></div>
      <div class="form-grid"><label>Name<input name="name"></label><label>Cron<input name="cron" value="0 4 * * *"></label></div>
      <label>Action<select name="action"><option>restart</option><option>backup</option><option>stop</option><option>start</option><option>command:say Scheduled message</option></select></label>
    </form>
    <div class="settings-list">${server.schedules.map((schedule) => `<div class="setting-item"><span>${escapeHtml(schedule.name)} <small class="muted">${escapeHtml(schedule.cron)}</small></span><div class="row-actions"><strong>${escapeHtml(schedule.action)}</strong><button class="mini-button" data-action="remove-resource" data-id="${escapeHtml(server.id)}" data-type="schedule" data-resource-id="${escapeHtml(schedule.id)}">${icon("ban")}Remove</button></div></div>`).join("")}</div>
  `;
}

function renderUsers(server) {
  return `
    <form class="stack-form control-panel" data-subuser-form data-id="${escapeHtml(server.id)}">
      <div class="section-header compact"><h2>Users</h2><button class="primary-button" type="submit">${icon("users")}Add</button></div>
      <div class="form-grid"><label>Name<input name="name"></label><label>Role<input name="role" value="Moderator"></label></div>
      <label>Permissions<input name="permissions" value="Start, Stop, Console, Files, Backups, Players"></label>
    </form>
    <div class="settings-list">${server.subusers.map((user) => `<div class="setting-item"><span>${escapeHtml(user.name)} <small class="muted">${escapeHtml(user.role)}</small></span><div class="row-actions"><strong>${escapeHtml(user.permissions?.join(", ") || user.role)}</strong><button class="mini-button" data-action="remove-resource" data-id="${escapeHtml(server.id)}" data-type="subuser" data-name="${escapeHtml(user.name)}">${icon("ban")}Remove</button></div></div>`).join("")}</div>
  `;
}

function renderBackups(server) {
  return `
    <div class="section-header compact"><h2>Backups</h2><button class="primary-button" data-action="backup-server" data-id="${escapeHtml(server.id)}">${icon("backup")}Create backup</button></div>
    <div class="file-list">${server.backups.map((backup) => `<div class="file-item"><span>${escapeHtml(backup.name)}</span><span class="muted">${escapeHtml(backup.size)}</span></div>`).join("") || `<div class="file-item"><span>No backups yet</span><span class="muted">empty</span></div>`}</div>
  `;
}

function renderStartup(server) {
  const paperVersion = selectedPaperVersion(server);
  return `
    <form class="stack-form control-panel" data-startup-form data-id="${escapeHtml(server.id)}">
      <div class="section-header compact"><h2>Startup</h2><button class="primary-button" type="submit">${icon("code")}Save</button></div>
      <div class="form-grid">
        <label>Runtime image<input name="image" value="${escapeHtml(server.startup.image)}"></label>
        <label>Paper version<select name="paperVersion" class="paper-version-select" data-selected="${escapeHtml(paperVersion)}">${paperVersionOptions(paperVersion)}</select></label>
      </div>
      <label>Command<textarea name="command" rows="3">${escapeHtml(server.startup.command)}</textarea></label>
      <label>Variables<textarea name="variablesText" rows="8">${escapeHtml(variablesText(server.startup.variables))}</textarea></label>
    </form>
  `;
}

function renderInstaller(type) {
  const server = selectedServer();
  const catalog = type === "plugin" ? state.pluginCatalog : state.modCatalog;
  return `
    <article class="panel-card search-panel">
      <div class="section-header"><div><p class="eyebrow">${type === "plugin" ? "Plugin Installer" : "Mod Management"}</p><h2>Search online repositories</h2></div><span class="status-pill">Modrinth + Spiget</span></div>
      <form class="search-form" data-search-form data-type="${type}">
        <label>Search<input name="query" placeholder="${type === "plugin" ? "luckperms, worldedit" : "sodium, create"}"></label>
        <label>Loader<select name="loader"><option value="${type === "plugin" ? "paper" : "fabric"}">${type === "plugin" ? "Paper" : "Fabric"}</option><option>bukkit</option><option>spigot</option><option>purpur</option><option>forge</option><option>neoforge</option><option value="">Any</option></select></label>
        <label>Version<input name="gameVersion" placeholder="1.21.4"></label>
        <label>Source<select name="source"><option value="all">All</option><option value="modrinth">Modrinth</option><option value="spiget">Spiget</option></select></label>
        <button class="primary-button" type="submit">${icon("search")}Search</button>
      </form>
      <div class="catalog-grid search-results">${renderSearchResults()}</div>
    </article>
    <div class="catalog-grid">
      ${catalog.map((item) => renderCatalogItem(item, type, server)).join("")}
    </div>
  `;
}

function renderSearchResults() {
  if (!searchResults.length) return `<div class="search-empty"><p class="muted">${escapeHtml(searchStatus)}</p></div>`;
  return searchResults.map((item, index) => `
    <div class="catalog-item external-item">
      <div class="catalog-top">
        <div class="external-icon">${item.iconUrl ? `<img src="${escapeHtml(item.iconUrl)}" alt="">` : icon(item.type === "plugin" ? "package" : "code", "catalog-svg")}</div>
        <div><h3>${escapeHtml(item.name)}</h3><div class="catalog-meta"><span>${escapeHtml(item.source)}</span><span>${escapeHtml(item.type)}</span><span>${Number(item.downloads || 0).toLocaleString("en-IN")} downloads</span></div></div>
        <span class="catalog-badge">${escapeHtml(item.version || "latest")}</span>
      </div>
      <p class="muted">${escapeHtml(item.description)}</p>
      <button class="primary-button wide" data-action="install-external" data-index="${index}">${icon(item.type === "plugin" ? "package" : "code")}Install</button>
    </div>
  `).join("");
}

function renderCatalogItem(item, type, server) {
  const list = type === "plugin" ? server.plugins : server.mods;
  const installed = list.includes(item.name);
  return `
    <div class="catalog-item">
      <div class="catalog-top">
        <div class="catalog-icon ${type}">${icon(item.icon || (type === "plugin" ? "package" : "code"), "catalog-svg")}</div>
        <div><h3>${escapeHtml(item.name)}</h3><div class="catalog-meta"><span>v${escapeHtml(item.version)}</span><span>${type}</span></div></div>
        <span class="catalog-badge">${installed ? "Installed" : "Ready"}</span>
      </div>
      <p class="muted">${escapeHtml(item.description)}</p>
      <button class="${installed ? "ghost-button" : "primary-button"} wide" ${installed ? "disabled" : ""} data-action="install-content" data-type="${type}" data-id="${escapeHtml(item.id)}">${icon(type === "plugin" ? "package" : "code")}${installed ? "Installed" : "Install"}</button>
    </div>
  `;
}

function renderPlayers(server) {
  const players = state.players.filter((player) => player.serverId === server.id);
  return `
    <div class="players-layout">
      <article class="panel-card">
        <div class="section-header"><h2>Player Management</h2><button class="ghost-button" id="syncPlayersBtn" type="button">${icon("users")}Sync</button></div>
        <div class="player-table">${players.map((player) => `<div class="player-row"><div><h3>${escapeHtml(player.name)}</h3><div class="player-meta"><span>${escapeHtml(player.role)}</span><span>${escapeHtml(player.status)}</span><span>${player.whitelisted ? "whitelisted" : "not whitelisted"}</span></div></div><div class="player-actions"><button class="mini-button" data-action="player" data-player-action="op" data-id="${escapeHtml(player.id)}">${icon("shield")}OP</button><button class="mini-button" data-action="player" data-player-action="whitelist" data-id="${escapeHtml(player.id)}">${icon("users")}Whitelist</button><button class="mini-button" data-action="player" data-player-action="kick" data-id="${escapeHtml(player.id)}">${icon("stop")}Kick</button><button class="mini-button" data-action="player" data-player-action="ban" data-id="${escapeHtml(player.id)}">${icon("ban")}Ban</button><button class="mini-button" data-action="player" data-player-action="delete" data-id="${escapeHtml(player.id)}">${icon("ban")}Remove</button></div></div>`).join("")}</div>
      </article>
      <article class="panel-card">
        <form class="stack-form" id="addPlayerForm">
          <h2>Add player</h2>
          <label>Name<input name="name"></label>
          <label>Role<select name="role"><option>Member</option><option>Builder</option><option>Moderator</option><option>Operator</option><option>Owner</option></select></label>
          <label class="checkbox-row"><input name="whitelisted" type="checkbox" checked> Whitelist</label>
          <button class="primary-button" type="submit">${icon("users")}Add player</button>
        </form>
        <form class="stack-form broadcast-form" id="broadcastForm">
          <h2>Broadcast</h2>
          <label>Message<textarea name="message" rows="4"></textarea></label>
          <button class="ghost-button" type="submit">${icon("send")}Send broadcast</button>
        </form>
      </article>
    </div>
  `;
}

function fillCreateOptions() {
  const eggSelect = $("#eggSelect");
  const providerSelect = $("#providerSelect");
  if (eggSelect) eggSelect.innerHTML = gameEggs.map((egg) => `<option>${escapeHtml(egg)}</option>`).join("");
  if (providerSelect && state) {
    providerSelect.innerHTML = providerCatalog
      .filter((provider) => state.settings.providers[provider.id])
      .map((provider) => `<option value="${provider.id}">${escapeHtml(provider.name)}</option>`)
      .join("");
  }
  $$(".paper-version-select").forEach(fillPaperVersionSelect);
  loadPaperVersions();
}

function fillAdminForm() {
  const form = $("#adminSettingsForm");
  if (!form || !state) return;
  form.panelName.value = state.settings.panelName;
  form.serverCost.value = state.settings.serverCost;
  form.maxServers.value = state.settings.maxServers;
  form.clickTarget.value = state.settings.clickTarget;
  form.clickReward.value = state.settings.clickReward;
  form.motd.value = state.settings.motd;
  for (const key of ["local", "pterodactyl", "codesandbox", "github", "vps"]) {
    form[key].checked = state.settings.providers[key];
  }
}

function fillAccountForm() {
  const form = $("#accountSettingsForm");
  if (!form || !currentUser) return;
  form.username.value = currentUser.username || "";
  form.email.value = currentUser.email || "";
  form.currentPassword.value = "";
  form.newPassword.value = "";
  form.confirmPassword.value = "";
  $("#accountSummaryName").textContent = currentUser.username || "User";
  $("#accountSummaryRole").textContent = currentUser.role || "user";
}

function toast(title, message) {
  const region = $("#toastRegion");
  const node = document.createElement("div");
  node.className = "toast";
  node.innerHTML = `<strong>${escapeHtml(title)}</strong><span>${escapeHtml(message)}</span>`;
  region.appendChild(node);
  setTimeout(() => node.remove(), 3600);
}

function bindStaticForms() {
  $("#loginForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const payload = await api("/api/auth/login", {
        method: "POST",
        body: { identifier: form.get("identifier"), password: form.get("password") }
      });
      localStorage.setItem(tokenKey, payload.token);
      if (pageMode === "panel") {
        location.href = "index.html";
        return;
      }
      await refresh();
    } catch (error) {
      toast("Login failed", error.message);
    }
  });

  $("#showRegisterBtn").addEventListener("click", () => $("#registerForm").classList.toggle("hidden"));

  $("#registerForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const payload = await api("/api/auth/register", {
        method: "POST",
        body: { username: form.get("username"), email: form.get("email"), password: form.get("password") }
      });
      localStorage.setItem(tokenKey, payload.token);
      if (pageMode === "panel") {
        location.href = "index.html";
        return;
      }
      await refresh();
    } catch (error) {
      toast("Register failed", error.message);
    }
  });

  $("#logoutBtn").addEventListener("click", async () => {
    try { await api("/api/auth/logout", { method: "POST", body: {} }); } catch {}
    localStorage.removeItem(tokenKey);
    showAuth();
  });

  $("#serverListBtn")?.addEventListener("click", () => renderServerPicker(true));
  $("#createServerBtn")?.addEventListener("click", () => $("#createModal").classList.remove("hidden"));
  $("#adminPanelBtn")?.addEventListener("click", () => {
    if (!canUseAdmin()) {
      toast("Admin locked", "Only admin accounts can open these settings.");
      return;
    }
    fillAdminForm();
    $("#adminModal").classList.remove("hidden");
  });
  $("#accountSettingsBtn")?.addEventListener("click", () => {
    fillAccountForm();
    $("#accountModal").classList.remove("hidden");
  });
  $$("[data-close-modal]").forEach((button) => button.addEventListener("click", () => button.closest(".modal").classList.add("hidden")));

  $("#createServerForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      name: form.get("name"),
      egg: form.get("egg"),
      provider: form.get("provider"),
      paperVersion: form.get("paperVersion") || "latest",
      region: form.get("region"),
      runtime: form.get("runtime"),
      ram: Number(form.get("ram")),
      cpu: Number(form.get("cpu")),
      disk: Number(form.get("disk")),
      autoStart: form.get("autoStart") === "on"
    };
    try {
      await api("/api/servers", { method: "POST", body });
      $("#createModal").classList.add("hidden");
      await refresh();
      openServer(state.selectedServerId);
    } catch (error) {
      toast("Create failed", error.message);
    }
  });

  $("#adminSettingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!canUseAdmin()) {
      toast("Admin locked", "Only admin accounts can save these settings.");
      return;
    }
    const form = event.currentTarget;
    const body = {
      panelName: form.panelName.value,
      serverCost: Number(form.serverCost.value),
      maxServers: Number(form.maxServers.value),
      clickTarget: Number(form.clickTarget.value),
      clickReward: Number(form.clickReward.value),
      motd: form.motd.value,
      providers: {
        local: form.local.checked,
        pterodactyl: form.pterodactyl.checked,
        codesandbox: form.codesandbox.checked,
        github: form.github.checked,
        vps: form.vps.checked
      }
    };
    try {
      await api("/api/admin/settings", { method: "POST", body });
      $("#adminModal").classList.add("hidden");
      await refresh();
      toast("Admin saved", "Economy and provider settings updated.");
    } catch (error) {
      toast("Admin error", error.message);
    }
  });

  $("#accountSettingsForm").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    if (form.newPassword.value && form.newPassword.value !== form.confirmPassword.value) {
      toast("Account error", "New password confirmation does not match.");
      return;
    }
    const body = {
      username: form.username.value,
      email: form.email.value,
      currentPassword: form.currentPassword.value,
      newPassword: form.newPassword.value
    };
    try {
      const payload = await api("/api/account/settings", { method: "POST", body });
      if (payload.user) currentUser = payload.user;
      $("#accountModal").classList.add("hidden");
      await refresh();
      toast("Account saved", "Your profile settings were updated.");
    } catch (error) {
      toast("Account error", error.message);
    }
  });
}

function bindDelegatedActions() {
  document.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action], [data-tab]");
    if (!button) return;
    if (button.dataset.tab) {
      setTab(button.dataset.tab);
      return;
    }
    const action = button.dataset.action;
    const id = button.dataset.id;
    try {
      if (button.id === "pickerCreateBtn" || action === "open-create") {
        $("#createModal").classList.remove("hidden");
        return;
      }
      if (action === "click-earn") {
        await api("/api/click", { method: "POST", body: {} });
        await refresh();
        return;
      }
      if (action === "buy-server-limit") {
        await api("/api/marketplace/server-limit", { method: "POST", body: {} });
        await refresh();
        toast("Marketplace", "Server limit upgraded by 1.");
        return;
      }
      if (action === "open-server") {
        openServer(id);
        return;
      }
      if (action === "power") {
        await api(`/api/servers/${id}/power`, { method: "POST", body: { action: button.dataset.power } });
        await refresh();
        return;
      }
      if (action === "backup-server") {
        await api(`/api/servers/${id}/backup`, { method: "POST", body: {} });
        await refresh();
        return;
      }
      if (action === "folder-open") {
        const folderPath = cleanUiPath(button.dataset.path);
        const payload = await api(`/api/servers/${id}/files?path=${encodeURIComponent(folderPath)}`);
        fileBrowser = { path: payload.path, entries: payload.files || [] };
        renderContent();
        return;
      }
      if (action === "file-load") {
        const payload = await api(`/api/servers/${id}/file?path=${encodeURIComponent(button.dataset.path)}`);
        const form = $("[data-file-save-form]");
        fileEditor = { path: payload.path, content: payload.content, loaded: true };
        form.elements.path.value = payload.path;
        form.elements.content.value = payload.content;
        return;
      }
      if (action === "file-delete") {
        if (!confirm(`Delete ${button.dataset.path}?`)) return;
        await api(`/api/servers/${id}/file/delete`, { method: "POST", body: { path: button.dataset.path } });
        fileBrowser.entries = [];
        await refresh();
        return;
      }
      if (action === "zip-open") {
        const zipPath = button.dataset.path;
        const dir = button.dataset.dir || "";
        const payload = await api(`/api/servers/${id}/zip?path=${encodeURIComponent(zipPath)}&dir=${encodeURIComponent(dir)}`);
        zipViewer = { zipPath: payload.path, dir: payload.dir || "", entries: payload.entries || [], previewEntry: "", previewContent: "" };
        renderContent();
        return;
      }
      if (action === "zip-preview") {
        const payload = await api(`/api/servers/${id}/zip/file?path=${encodeURIComponent(button.dataset.path)}&entry=${encodeURIComponent(button.dataset.entry)}`);
        zipViewer.previewEntry = payload.entry;
        zipViewer.previewContent = payload.content;
        renderContent();
        return;
      }
      if (action === "zip-extract") {
        await api(`/api/servers/${id}/zip/extract`, { method: "POST", body: { path: button.dataset.path, entry: button.dataset.entry || "", targetPath: fileBrowser.path } });
        fileBrowser.entries = [];
        await refresh();
        return;
      }
      if (action === "zip-close") {
        zipViewer = { zipPath: "", dir: "", entries: [], previewEntry: "", previewContent: "" };
        renderContent();
        return;
      }
      if (action === "remove-resource") {
        await api(`/api/servers/${id}/remove`, { method: "POST", body: { type: button.dataset.type, value: button.dataset.value, id: button.dataset.resourceId, name: button.dataset.name } });
        await refresh();
        return;
      }
      if (action === "install-content") {
        const server = selectedServer();
        await api(`/api/servers/${server.id}/install`, { method: "POST", body: { type: button.dataset.type, itemId: button.dataset.id } });
        await refresh();
        return;
      }
      if (action === "install-external") {
        const server = selectedServer();
        const item = searchResults[Number(button.dataset.index)];
        const form = $("[data-search-form]");
        await api(`/api/servers/${server.id}/install-external`, { method: "POST", body: { ...item, loader: form?.elements.loader.value || "", gameVersion: form?.elements.gameVersion.value || "" } });
        await refresh();
        return;
      }
      if (action === "player") {
        await api(`/api/players/${id}/action`, { method: "POST", body: { action: button.dataset.playerAction } });
        await refresh();
      }
    } catch (error) {
      toast("Action failed", error.message);
    }
  });

  document.addEventListener("submit", async (event) => {
    const server = selectedServer();
    const form = event.target;
    try {
      if (form.matches("[data-command-form]")) {
        event.preventDefault();
        const command = form.elements.command.value.trim();
        if (!command) return;
        await api(`/api/servers/${form.dataset.id}/command`, { method: "POST", body: { command } });
        await refresh();
      } else if (form.matches("[data-file-save-form]")) {
        event.preventDefault();
        const data = new FormData(form);
        const done = setButtonBusy(form.querySelector("[data-save-file-button]"), "Saving...");
        try {
          await Promise.all([
            api(`/api/servers/${form.dataset.id}/file`, { method: "POST", body: { path: data.get("path"), content: data.get("content") } }),
            delay(2000)
          ]);
        } finally {
          done();
        }
        fileEditor = { path: data.get("path"), content: data.get("content"), loaded: true };
        fileBrowser.entries = [];
        await refresh();
      } else if (form.matches("[data-folder-form]")) {
        event.preventDefault();
        const data = new FormData(form);
        await api(`/api/servers/${form.dataset.id}/folder`, { method: "POST", body: { path: data.get("path") } });
        fileBrowser.entries = [];
        await refresh();
      } else if (form.matches("[data-upload-form]")) {
        event.preventDefault();
        const data = new FormData(form);
        const picked = [
          ...Array.from(form.elements.files.files || []),
          ...Array.from(form.elements.folderFiles.files || [])
        ];
        if (!picked.length) {
          toast("Upload failed", "Select files or a folder first.");
          return;
        }
        const done = setButtonBusy(form.querySelector("[data-upload-button]"), "Uploading...");
        const files = [];
        for (const file of picked.slice(0, 120)) {
          files.push({
            name: file.name,
            relativePath: file.webkitRelativePath || file.name,
            dataUrl: await readFileAsDataUrl(file)
          });
        }
        try {
          await api(`/api/servers/${form.dataset.id}/upload`, { method: "POST", body: { targetPath: data.get("targetPath"), files } });
        } finally {
          done();
        }
        fileBrowser.entries = [];
        await refresh();
      } else if (form.matches("[data-identity-form]")) {
        event.preventDefault();
        const data = new FormData(form);
        const iconDataUrl = await readFileAsDataUrl(form.elements.iconFile.files[0]);
        await api(`/api/servers/${form.dataset.id}/identity`, { method: "POST", body: { motd: data.get("motd"), iconUrl: data.get("iconUrl"), iconDataUrl } });
        await refresh();
      } else if (form.matches("[data-server-settings-form]")) {
        event.preventDefault();
        const data = new FormData(form);
        await api(`/api/servers/${form.dataset.id}/settings`, {
          method: "POST",
          body: {
            name: data.get("name"), motd: data.get("motd"), ram: Number(data.get("ram")), cpu: Number(data.get("cpu")), disk: Number(data.get("disk")),
            slots: Number(data.get("slots")), gamemode: data.get("gamemode"), difficulty: data.get("difficulty"), spawnProtection: Number(data.get("spawnProtection")),
            timezone: data.get("timezone"), whitelist: data.get("whitelist") === "on", pvp: data.get("pvp") === "on", commandBlocks: data.get("commandBlocks") === "on",
            cracked: data.get("cracked") === "on", fly: data.get("fly") === "on", monsters: data.get("monsters") === "on", animals: data.get("animals") === "on", nether: data.get("nether") === "on"
          }
        });
        await refresh();
      } else if (form.matches("[data-network-form]")) {
        event.preventDefault();
        const data = new FormData(form);
        await api(`/api/servers/${form.dataset.id}/network`, { method: "POST", body: { port: data.get("port"), primary: data.get("primary") === "on" } });
        await refresh();
      } else if (form.matches("[data-database-form]")) {
        event.preventDefault();
        const data = new FormData(form);
        await api(`/api/servers/${form.dataset.id}/databases`, { method: "POST", body: { name: data.get("name"), user: data.get("user"), host: data.get("host") } });
        await refresh();
      } else if (form.matches("[data-schedule-form]")) {
        event.preventDefault();
        const data = new FormData(form);
        await api(`/api/servers/${form.dataset.id}/schedules`, { method: "POST", body: { name: data.get("name"), cron: data.get("cron"), action: data.get("action") } });
        await refresh();
      } else if (form.matches("[data-startup-form]")) {
        event.preventDefault();
        const data = new FormData(form);
        await api(`/api/servers/${form.dataset.id}/startup`, { method: "POST", body: { image: data.get("image"), command: data.get("command"), paperVersion: data.get("paperVersion"), variablesText: data.get("variablesText") } });
        await refresh();
      } else if (form.matches("[data-subuser-form]")) {
        event.preventDefault();
        const data = new FormData(form);
        await api(`/api/servers/${form.dataset.id}/subusers`, { method: "POST", body: { name: data.get("name"), role: data.get("role"), permissions: data.get("permissions") } });
        await refresh();
      } else if (form.matches("[data-search-form]")) {
        event.preventDefault();
        const data = new FormData(form);
        searchStatus = "Searching...";
        searchResults = [];
        renderContent();
        const params = new URLSearchParams({ query: data.get("query"), type: form.dataset.type, loader: data.get("loader"), gameVersion: data.get("gameVersion"), source: data.get("source"), limit: "12" });
        const payload = await api(`/api/catalog/search?${params.toString()}`);
        searchResults = payload.results || [];
        searchStatus = searchResults.length ? `Found ${searchResults.length} results.` : "No results found.";
        renderContent();
      } else if (form.id === "addPlayerForm") {
        event.preventDefault();
        const data = new FormData(form);
        await api(`/api/servers/${server.id}/players`, { method: "POST", body: { name: data.get("name"), role: data.get("role"), whitelisted: data.get("whitelisted") === "on" } });
        await refresh();
      } else if (form.id === "broadcastForm") {
        event.preventDefault();
        const data = new FormData(form);
        await api("/api/broadcast", { method: "POST", body: { message: data.get("message") } });
        await refresh();
      }
    } catch (error) {
      toast("Save failed", error.message);
    }
  });
}

async function init() {
  bindStaticForms();
  bindDelegatedActions();
  activeTab = location.hash.replace("#", "") || "console";
  if (!localStorage.getItem(tokenKey)) {
    showAuth();
    return;
  }
  try {
    await refresh();
  } catch {
    localStorage.removeItem(tokenKey);
    showAuth();
  }
  setInterval(() => {
    const shell = pageMode === "dashboard" ? $("#dashboardShell") : pageMode === "marketplace" ? $("#marketplaceShell") : $("#panelShell");
    if (shell && !shell.classList.contains("hidden")) refresh().catch(() => {});
  }, 8000);
}

init();
