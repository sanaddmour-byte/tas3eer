#!/usr/bin/env bash
# Local PostgreSQL without Docker (Debian/Ubuntu postgresql-16 packages). Usage: scripts/dev-db.sh start|stop
set -euo pipefail
BIN=/usr/lib/postgresql/16/bin; DIR=${PGDEV_DIR:-/var/lib/pgdev}
case "${1:-start}" in
  start)
    if [ ! -d "$DIR/data" ]; then mkdir -p "$DIR" && chown postgres "$DIR"
      su postgres -c "$BIN/initdb -D $DIR/data -A trust -E UTF8 >/dev/null"; fi
    su postgres -c "$BIN/pg_ctl -D $DIR/data -o '-p 5432 -k /tmp' -l $DIR/log -w start" || true
    su postgres -c "psql -h /tmp -tc \"select 1 from pg_roles where rolname='rm'\" | grep -q 1 || psql -h /tmp -c \"create user rm with superuser password 'rm'\""
    for d in readymix readymix_test; do su postgres -c "psql -h /tmp -tc \"select 1 from pg_database where datname='$d'\" | grep -q 1 || psql -h /tmp -c 'create database $d owner rm'"; done ;;
  stop) su postgres -c "$BIN/pg_ctl -D $DIR/data stop" ;;
esac
