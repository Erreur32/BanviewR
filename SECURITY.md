# Security policy

BanviewR drives fail2ban and the host firewall: a flaw in it can matter. Thanks for reporting one privately.

## Reporting a vulnerability

Use **Report a vulnerability** in the [Security tab](https://github.com/Erreur32/BanviewR/security) of this repository. The report stays private until a fix is out. Please do not open a public issue or discussion for it.

Include what you can: the version, how BanviewR runs (Docker or not), the steps to reproduce and what an attacker gains.

## Supported versions

Only the latest release gets security fixes while the project is in 0.x.

## Scope notes

- BanviewR listens on `127.0.0.1` by default and is meant to sit behind a reverse proxy with HTTPS.
- Access to fail2ban's socket is equivalent to root on the host; the Docker image needs it, and `NET_ADMIN` for the firewall audit and blocklists. These are documented trade-offs, not vulnerabilities by themselves.
