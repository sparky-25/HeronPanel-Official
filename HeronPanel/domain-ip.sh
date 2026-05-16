#!/usr/bin/env bash
set -euo pipefail

APP_NAME="HeronPanel Domain/IP Setup"
DEFAULT_PANEL_PORT="4173"
DEFAULT_MC_PORT="25565"

line() {
  printf '%s\n' "------------------------------------------------------------"
}

title() {
  clear 2>/dev/null || true
  line
  printf ' %s\n' "$APP_NAME"
  line
}

need_value() {
  local prompt="$1"
  local fallback="${2:-}"
  local value
  if [ -n "$fallback" ]; then
    read -r -p "$prompt [$fallback]: " value
    printf '%s' "${value:-$fallback}"
  else
    read -r -p "$prompt: " value
    while [ -z "$value" ]; do
      read -r -p "$prompt: " value
    done
    printf '%s' "$value"
  fi
}

has_cmd() {
  command -v "$1" >/dev/null 2>&1
}

write_web_config() {
  local tunnel="$1"
  local domain="$2"
  local port="$3"
  cat > cloudflare-tunnel.yml <<EOF
tunnel: ${tunnel}
credentials-file: ~/.cloudflared/${tunnel}.json

ingress:
  - hostname: ${domain}
    service: http://127.0.0.1:${port}
  - service: http_status:404
EOF
}

write_tcp_config() {
  local tunnel="$1"
  local domain="$2"
  local port="$3"
  cat > cloudflare-tunnel.yml <<EOF
tunnel: ${tunnel}
credentials-file: ~/.cloudflared/${tunnel}.json

ingress:
  - hostname: ${domain}
    service: tcp://127.0.0.1:${port}
  - service: http_status:404
EOF
}

write_docker_compose() {
  local token="$1"
  cat > docker-compose.cloudflared.yml <<EOF
services:
  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: heronpanel-cloudflared
    restart: unless-stopped
    command: tunnel --no-autoupdate run --token ${token}
EOF
}

print_token_commands() {
  local token="$1"
  line
  printf 'Cloudflare Tunnel Docker command:\n\n'
  printf 'docker run -d --name heronpanel-cloudflared --restart unless-stopped cloudflare/cloudflared:latest tunnel --no-autoupdate run --token %s\n\n' "$token"
  write_docker_compose "$token"
  printf 'Docker Compose file created: docker-compose.cloudflared.yml\n'
  printf 'Run it with:\n\n'
  printf 'docker compose -f docker-compose.cloudflared.yml up -d\n'
}

website_setup() {
  title
  printf 'Website Custom Domain Setup\n\n'
  local domain
  local port
  local mode
  domain="$(need_value 'Enter website domain/subdomain, example panel.example.com')"
  port="$(need_value 'Local HeronPanel web port' "$DEFAULT_PANEL_PORT")"
  line
  printf 'Choose setup mode:\n'
  printf '1) Cloudflare dashboard token / Docker command\n'
  printf '2) Local cloudflared login/create/route/run\n'
  printf '3) Quick trycloudflare.com tunnel for testing\n'
  read -r -p 'Select option [1]: ' mode
  mode="${mode:-1}"

  if [ "$mode" = "1" ]; then
    local token
    token="$(need_value 'Paste Cloudflare Tunnel token')"
    printf '\nIn Cloudflare Zero Trust, make sure Public Hostname points:\n'
    printf '  Hostname: %s\n' "$domain"
    printf '  Service:  http://127.0.0.1:%s\n\n' "$port"
    print_token_commands "$token"
    return
  fi

  if [ "$mode" = "3" ]; then
    printf '\nRun this test tunnel:\n\n'
    printf 'cloudflared tunnel --url http://127.0.0.1:%s\n' "$port"
    return
  fi

  local tunnel
  tunnel="$(need_value 'Tunnel name' 'heronpanel-web')"
  write_web_config "$tunnel" "$domain" "$port"
  printf '\nGenerated cloudflare-tunnel.yml\n\n'
  printf 'Run these commands:\n\n'
  printf 'cloudflared tunnel login\n'
  printf 'cloudflared tunnel create %s\n' "$tunnel"
  printf 'cloudflared tunnel route dns %s %s\n' "$tunnel" "$domain"
  printf 'cloudflared tunnel --config cloudflare-tunnel.yml run %s\n' "$tunnel"
}

minecraft_setup() {
  title
  printf 'Minecraft IP Setup\n\n'
  printf 'Important:\n'
  printf '- Normal Minecraft clients need a public TCP address. Best VPS setup is DNS A + SRV.\n'
  printf '- Cloudflare Tunnel TCP can be used, but players usually need cloudflared client/access on their side.\n\n'
  local mode
  printf 'Choose setup:\n'
  printf '1) Normal VPS DNS A/SRV records\n'
  printf '2) Cloudflare TCP tunnel profile\n'
  printf '3) Docker tunnel token command\n'
  read -r -p 'Select option [1]: ' mode
  mode="${mode:-1}"

  local domain
  local port
  domain="$(need_value 'Enter Minecraft domain/subdomain, example play.example.com')"
  port="$(need_value 'Minecraft server port' "$DEFAULT_MC_PORT")"

  if [ "$mode" = "1" ]; then
    local ip
    ip="$(need_value 'Your VPS public IPv4')"
    line
    printf 'Create these Cloudflare DNS records:\n\n'
    printf 'A record:\n'
    printf '  Name: %s\n' "$domain"
    printf '  IPv4: %s\n' "$ip"
    printf '  Proxy: DNS only / gray cloud\n\n'
    printf 'If you want players to join without :%s, add SRV:\n' "$port"
    printf '  Type: SRV\n'
    printf '  Name: _minecraft._tcp.%s\n' "$domain"
    printf '  Priority: 0\n'
    printf '  Weight: 5\n'
    printf '  Port: %s\n' "$port"
    printf '  Target: %s\n' "$domain"
    return
  fi

  if [ "$mode" = "3" ]; then
    local token
    token="$(need_value 'Paste Cloudflare Tunnel token')"
    printf '\nIn Cloudflare Zero Trust Public Hostname, use TCP service:\n'
    printf '  Hostname: %s\n' "$domain"
    printf '  Service:  tcp://127.0.0.1:%s\n\n' "$port"
    print_token_commands "$token"
    printf '\nClient side example for players using Cloudflare Access TCP:\n'
    printf 'cloudflared access tcp --hostname %s --url localhost:%s\n' "$domain" "$port"
    return
  fi

  local tunnel
  tunnel="$(need_value 'Tunnel name' 'heronpanel-minecraft')"
  write_tcp_config "$tunnel" "$domain" "$port"
  printf '\nGenerated cloudflare-tunnel.yml\n\n'
  printf 'Run these commands:\n\n'
  printf 'cloudflared tunnel login\n'
  printf 'cloudflared tunnel create %s\n' "$tunnel"
  printf 'cloudflared tunnel route dns %s %s\n' "$tunnel" "$domain"
  printf 'cloudflared tunnel --config cloudflare-tunnel.yml run %s\n\n' "$tunnel"
  printf 'Player/client side TCP command:\n'
  printf 'cloudflared access tcp --hostname %s --url localhost:%s\n' "$domain" "$port"
}

main_menu() {
  title
  printf 'Works on GitHub Codespaces, CodeSandbox, real VPS, and local machines if cloudflared or Docker is available.\n\n'
  printf '1) Minecraft IP Setup\n'
  printf '2) Website Custom Domain Setup\n'
  printf '3) Check installed tools\n'
  printf '0) Exit\n\n'
  read -r -p 'Select option: ' choice
  case "${choice:-}" in
    1) minecraft_setup ;;
    2) website_setup ;;
    3)
      line
      has_cmd cloudflared && printf 'cloudflared: found\n' || printf 'cloudflared: not found\n'
      has_cmd docker && printf 'docker: found\n' || printf 'docker: not found\n'
      has_cmd node && printf 'node: found\n' || printf 'node: not found\n'
      ;;
    0) exit 0 ;;
    *) printf 'Invalid option\n' ;;
  esac
}

main_menu
