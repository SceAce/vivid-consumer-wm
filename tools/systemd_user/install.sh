#!/usr/bin/env bash

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
USER_UNIT_DIR="${VIVID_SYSTEMD_USER_DIR:-${HOME}/.config/systemd/user}"
SYSTEMCTL_BIN="${SYSTEMCTL_BIN:-systemctl}"
DRY_RUN=0

SERVICES=(
    vivid-producer.service
    vivid-webui.service
    vivid-wayland-hyprland.service
)
TARGET="vivid-hyprland.target"
ALL_UNITS=("${SERVICES[@]}" "${TARGET}")

usage() {
    cat <<'EOF'
Usage: tools/systemd_user/install.sh [--dry-run] {install|start|stop|restart|status|logs}

Commands:
  install   Render user unit files into ~/.config/systemd/user and daemon-reload.
  start     Start vivid-hyprland.target.
  stop      Stop vivid-hyprland.target.
  restart   Restart vivid-hyprland.target.
  status    Show status for the target and its services.
  logs      Show recent logs for the target and its services.

Options:
  --dry-run Print planned file writes and systemctl commands without applying them.
EOF
}

die() {
    echo "Error: $*" >&2
    exit 1
}

render_unit() {
    local template_path="$1"
    local output_path="$2"

    sed "s#@REPO_ROOT@#${REPO_ROOT}#g" "${template_path}" >"${output_path}"
}

run_cmd() {
    if [[ "${DRY_RUN}" -ne 0 ]]; then
        printf 'DRY-RUN:'
        printf ' %q' "$@"
        printf '\n'
        return 0
    fi

    "$@"
}

require_command() {
    command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

install_units() {
    local unit
    local template_path
    local output_path

    require_command sed
    require_command "${SYSTEMCTL_BIN}"

    run_cmd mkdir -p "${USER_UNIT_DIR}"
    for unit in "${ALL_UNITS[@]}"; do
        template_path="${SCRIPT_DIR}/${unit}.in"
        output_path="${USER_UNIT_DIR}/${unit}"
        if [[ "${DRY_RUN}" -ne 0 ]]; then
            echo "DRY-RUN: render ${template_path} -> ${output_path}"
            continue
        fi
        render_unit "${template_path}" "${output_path}"
        echo "Installed ${output_path}"
    done

    run_cmd "${SYSTEMCTL_BIN}" --user daemon-reload

    cat <<EOF
Installed Vivid user units in ${USER_UNIT_DIR}

Next commands:
  tools/vivid.sh systemd-user start
  # or from Hyprland:
  exec-once = systemctl --user start ${TARGET}
  systemctl --user status ${TARGET}
EOF
}

manage_target() {
    local action="$1"
    require_command "${SYSTEMCTL_BIN}"
    run_cmd "${SYSTEMCTL_BIN}" --user "${action}" "${TARGET}"
}

status_units() {
    require_command "${SYSTEMCTL_BIN}"
    run_cmd "${SYSTEMCTL_BIN}" --user status "${TARGET}" "${SERVICES[@]}"
}

logs_units() {
    require_command journalctl
    run_cmd journalctl --user -u "${TARGET}" \
        -u vivid-producer.service \
        -u vivid-webui.service \
        -u vivid-wayland-hyprland.service \
        -n 200 \
        --no-pager
}

main() {
    local action=

    while [[ $# -gt 0 ]]; do
        case "$1" in
            --dry-run)
                DRY_RUN=1
                shift
                ;;
            help|-h|--help)
                usage
                return 0
                ;;
            *)
                action="$1"
                shift
                break
                ;;
        esac
    done

    [[ -n "${action}" ]] || {
        usage >&2
        exit 2
    }
    [[ $# -eq 0 ]] || die "unexpected arguments: $*"

    case "${action}" in
        install)
            install_units
            ;;
        start)
            manage_target start
            ;;
        stop)
            manage_target stop
            ;;
        restart)
            manage_target restart
            ;;
        status)
            status_units
            ;;
        logs)
            logs_units
            ;;
        *)
            usage >&2
            exit 2
            ;;
    esac
}

main "$@"
