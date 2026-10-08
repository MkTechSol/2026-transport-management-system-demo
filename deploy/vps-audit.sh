#!/usr/bin/env bash
# READ-ONLY inventory of a Linux VPS. Makes no changes. Run on the server and send the output (secrets are not printed):
#   ssh taktak-vps 'bash -s' < deploy/vps-audit.sh > vps-audit-output.txt
set -u
h() { printf '\n==== %s ====\n' "$1"; }
h "OS / kernel";            (. /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"); uname -srm
h "CPU / RAM / swap";       nproc; free -h
h "Disk";                   df -hT / /var /opt /home 2>/dev/null | sort -u
h "Uptime / load";          uptime
h "Docker";                 (docker --version && docker compose version) 2>&1 | head -3
h "Docker containers";      docker ps --format 'table {{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Status}}' 2>&1 | head -60
h "Docker compose projects"; docker compose ls 2>&1 | head -30
h "Docker volumes (names only)"; docker volume ls --format '{{.Name}}' 2>&1 | head -40
h "Listening ports";        (ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | awk 'NR==1 || /LISTEN/' | head -60
h "nginx";                  nginx -v 2>&1; ls -1 /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null
h "nginx server_names";     grep -RhoE '^\s*server_name\s+[^;]+' /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null | sort -u
h "Apache / caddy / traefik"; (systemctl is-active apache2 caddy traefik 2>/dev/null) | paste -sd' '
h "TLS certificates";       (certbot certificates 2>/dev/null | grep -E 'Certificate Name|Domains|Expiry Date') || ls /etc/letsencrypt/live 2>/dev/null
h "Node / npm / pm2";       node -v 2>&1; npm -v 2>&1; (pm2 -v && pm2 list) 2>&1 | head -40
h "systemd services (running, non-system)"; systemctl list-units --type=service --state=running --no-legend 2>/dev/null | awk '{print $1}' | grep -vE '^(systemd|dbus|getty|cron|ssh|rsyslog|polkit|snapd|unattended|multipathd|networkd|resolved|udisks|ModemManager|packagekit)' | head -40
h "Databases";              (systemctl is-active mysql mariadb postgresql redis-server mongod 2>/dev/null) | paste -sd' '; mysql --version 2>&1 | head -1; psql --version 2>&1 | head -1
h "App directories";        ls -1 /var/www /opt /srv /home/*/ 2>/dev/null | head -80
h "Firewall";               (ufw status 2>/dev/null || iptables -S 2>/dev/null | head -20)
h "Cron / backups";         crontab -l 2>/dev/null; ls /etc/cron.d 2>/dev/null; ls -la /var/backups 2>/dev/null | head
h "Monitoring / logging";   (systemctl is-active prometheus grafana-server netdata fail2ban 2>/dev/null) | paste -sd' '; ls /var/log | head -30
