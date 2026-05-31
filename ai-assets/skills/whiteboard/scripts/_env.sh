#!/bin/bash
# _env.sh — Shared env loader for whiteboard and handoff scripts.
# Source this at the top of any script that needs EXPERT_API_BASE, OPENTEAM_CHAT_ID, etc.
# Claude CLI's Bash tool may not inherit the env vars set via child_process.spawn,
# so we fall back to reading from a persisted env file.

if [ -z "${EXPERT_API_BASE:-}" ] || [ -z "${OPENTEAM_CHAT_ID:-}" ] || [ -z "${OPENTEAM_INSTANCE_ID:-}" ]; then
  _ENV_DIR="${HOME}/.openteam/tmp/env"
  if [ -d "$_ENV_DIR" ]; then
    _LATEST_ENV=$(ls -t "$_ENV_DIR"/*.env 2>/dev/null | head -1)
    if [ -n "${_LATEST_ENV:-}" ]; then
      # shellcheck disable=SC1090
      source "$_LATEST_ENV"
    fi
  fi
  unset _ENV_DIR _LATEST_ENV
fi
