# BanviewR

Web UI for fail2ban: jails, bans, stats, map, firewall audit (iptables/ipset/nftables) and an MCP server.

Built with React 19, Express 5, SQLite and WebSocket. Extracted from [LogviewR](https://github.com/Erreur32/LogviewR).

## Status

Early bootstrap, nothing usable yet.

## Roadmap

- **v0.1:** port the fail2ban part of LogviewR, external mode (host fail2ban via its socket and `fail2ban.sqlite3`)
- **v0.2:** embedded mode, the container runs `fail2ban-server` itself when no host socket is found
- **Later:** multi-host, one UI driving several hosts
