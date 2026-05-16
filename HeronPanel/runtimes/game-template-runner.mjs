const [name = "Server", game = "Game", port = "25565"] = process.argv.slice(2);
console.log(`[HeronPanel] ${game} template booted for ${name} on port ${port}.`);
console.log("[HeronPanel] Replace this template runner with the real game binary command when ready.");
let tick = 0;
setInterval(() => {
  tick += 1;
  console.log(`[HeronPanel] ${game} heartbeat ${tick}: process alive`);
}, 15000);
process.on("SIGTERM", () => {
  console.log("[HeronPanel] Stop signal received.");
  process.exit(0);
});
process.stdin.on("data", (chunk) => {
  console.log(`[command] ${String(chunk).trim()}`);
});
