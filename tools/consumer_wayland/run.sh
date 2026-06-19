#!/usr/bin/env bash

set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
    echo "Error: this script should not be run as root" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../consumer/wayland" && pwd)"
. "${SCRIPT_DIR}/build_env.sh"

usage() {
    cat <<'EOF'
Usage: tools/vivid.sh wayland {build|clean|run}

Actions:
  build [meson-options...]  Configure and build the Wayland layer-shell probe.
  run [probe-args...]       Run the probe executable. Use --help for probe help.
EOF
}

probe_usage() {
    cat <<'EOF'
Usage: vivid-consumer-wayland-probe [--help|--probe]

Options:
  --help   Print this help and exit.
  --probe  Initialize GTK and probe Gtk4LayerShell GI bindings.

This probe does not connect to a Vivid producer socket.
EOF
}

configure() {
    if [[ -f "${VIVID_WAYLAND_BUILD_DIR}/build.ninja" ]]; then
        meson setup --reconfigure "${VIVID_WAYLAND_BUILD_DIR}" "${ROOT_DIR}" "$@"
    else
        meson setup "${VIVID_WAYLAND_BUILD_DIR}" "${ROOT_DIR}" \
            --prefix="${VIVID_WAYLAND_INSTALL_PREFIX}" "$@"
    fi
}

build() {
    configure "$@"
    ninja -C "${VIVID_WAYLAND_BUILD_DIR}"
    chmod +x "${VIVID_WAYLAND_PROBE}"
}

run_probe() {
    case "${1:-}" in
        --help|-h)
            probe_usage
            return 0
            ;;
    esac

    if [[ ! -x "${VIVID_WAYLAND_PROBE}" ]]; then
        build
    fi

    "${VIVID_WAYLAND_PROBE}" "$@"
}

case "${1:-help}" in
    build)
        shift
        build "$@"
        ;;
    run)
        shift
        run_probe "$@"
        ;;
    help|-h|--help)
        usage
        ;;
    *)
        echo "Error: unknown Wayland consumer action: ${1}" >&2
        echo >&2
        usage >&2
        exit 2
        ;;
esac
