#!/usr/bin/env bash
# Dev only, isolation level 1 of the embedded mode: BanviewR and its embedded fail2ban run in a
# container with its OWN network namespace (never the host network), so bans and firewall rules stay
# inside the container. Never run fail2ban on the dev machine itself.
#
#   npm run dev:embedded -- start   # BanviewR from this checkout (server/, shared/) on 127.0.0.1:3027
#   npm run dev:embedded -- logs
#   npm run dev:embedded -- stop    # removes the container, data-dev/ is kept
#
# The web app served on 3027 is the image's build: for the current UI, point a Vite dev server at it
# (PORT=3027 VITE_PORT=5186 npx vite). The data folder has the same path inside and outside, so a dev
# server on the host can also drive this fail2ban with F2B_CLIENT=./scripts/dev-f2b-client.sh.
set -euo pipefail
cd "$(dirname "$0")/.."

NAME=banviewr-dev-embedded
IMAGE=${BVR_DEV_IMAGE:-ghcr.io/erreur32/banviewr:0.1.1}
PORT=${BVR_DEV_EMBEDDED_PORT:-3027}
DIR="$PWD/data-dev"

case "${1:-}" in
  start)
    mkdir -p "$DIR/fail2ban/etc/jail.d"
    # A jail fed by manual bans only, to try ban and unban from the UI
    jail="$DIR/fail2ban/etc/jail.d/dev-manual.local"
    [ -e "$jail" ] || printf '[manual]\nenabled = true\nfilter =\nlogpath = /dev/null\nbackend = polling\nport = 22\n' >"$jail"
    docker run -d --name "$NAME" \
      --cap-add NET_ADMIN --cap-add NET_RAW \
      -p "127.0.0.1:$PORT:$PORT" \
      -e HOST=0.0.0.0 -e PORT="$PORT" -e DATA_DIR="$DIR" -e EMBEDDED_ALLOWED=true \
      -v "$DIR:$DIR" \
      -v "$PWD/server:/app/server:ro" \
      -v "$PWD/shared:/app/shared:ro" \
      "$IMAGE" >/dev/null
    mode=$(docker inspect -f '{{.HostConfig.NetworkMode}}' "$NAME")
    if [ "$mode" = host ]; then
      docker rm -f "$NAME" >/dev/null
      echo "Refused: the container got the host network" >&2
      exit 1
    fi
    echo "BanviewR (embedded mode allowed) on http://127.0.0.1:$PORT, network $mode, data in $DIR"
    ;;
  stop) docker rm -f "$NAME" >/dev/null && echo "Removed $NAME" ;;
  logs) docker logs -f "$NAME" ;;
  *)
    echo "Usage: $0 start|stop|logs" >&2
    exit 1
    ;;
esac
