# HeronPanel on Railway

This template runs HeronPanel with Node.js 22, Java 21, and Python 3 so the panel can start Minecraft Paper servers and bot templates from the dashboard.

## Deploy

1. Push this repository to GitHub.
2. Open Railway and create a new project from the GitHub repository.
3. Railway will detect `railway.json` and build with the included `Dockerfile`.
4. Add a Railway Volume mounted to:

```text
/app/data
```

5. Deploy the service.

## Panel Networking

The panel listens on Railway's `PORT` automatically and binds to `0.0.0.0`.

Open the generated Railway HTTP domain to access HeronPanel.

## Minecraft Networking

Minecraft uses raw TCP, not HTTP. Railway supports TCP Proxy for game servers.

For the first Minecraft server:

1. Create the server in HeronPanel using port `25565`.
2. In Railway service settings, open Networking.
3. Add TCP Proxy.
4. Target/internal port:

```text
25565
```

5. Railway will give a TCP address like:

```text
xxxx.proxy.rlwy.net:12345
```

Players must join using that generated host and port.

## Multiple Minecraft Servers

Each Minecraft server needs a unique internal port, for example:

```text
25565
25566
25567
```

For every server port, add a separate Railway TCP Proxy entry if Railway allows it on your plan/project. If you need many always-on Minecraft servers, a VPS is more suitable than Railway.

## Important Limits

Railway can run this template, but Minecraft hosting needs CPU, RAM, persistent disk, and TCP networking. For production hosting with many servers, use a VPS or dedicated server.
