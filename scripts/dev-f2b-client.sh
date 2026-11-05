#!/bin/sh
# Dev only: the dev machine has no fail2ban-client. A dev server started with
# F2B_CLIENT=./scripts/dev-f2b-client.sh runs the client of the dev embedded container instead
# (scripts/dev-embedded.sh). Arguments are passed as they are, without a shell in between; the socket
# path is valid on both sides because data-dev/ is mounted at the same path.
exec docker exec banviewr-dev-embedded fail2ban-client "$@"
