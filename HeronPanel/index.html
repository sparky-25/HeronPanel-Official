const [, , serverId = "server", serverName = "HeronPanel Server"] = process.argv;

let tick = 0;

function log(message) {
  process.stdout.write(`${message}\n`);
}

log(`Local managed runtime attached to ${serverName} (${serverId}).`);
log("Ready for console commands. Replace startup.command with a real Minecraft command when your jar is present.");

const heartbeat = setInterval(() => {
  tick += 1;
  log(`heartbeat ${tick}: ${serverName} process alive`);
}, 15000);

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  for (const line of chunk.split(/\r?\n/)) {
    const command = line.trim();
    if (!command) continue;
    if (command === "stop") {
      log("stop command received");
      clearInterval(heartbeat);
      process.exit(0);
    }
    if (command.startsWith("say ")) {
      log(`[broadcast] ${command.slice(4)}`);
      continue;
    }
    log(`command executed: ${command}`);
  }
});

process.on("SIGTERM", () => {
  log("SIGTERM received, shutting down");
  clearInterval(heartbeat);
  process.exit(0);
});
