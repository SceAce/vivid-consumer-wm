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
    if [[ ! -x "${VIVID_WAYLAND_PROBE}" ]]; then
        build
    fi

    "${VIVID_WAYLAND_PROBE}" --help
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

gtk4_layer_shell_preload() {
    local candidate

    for candidate in \
        /usr/lib/libgtk4-layer-shell.so \
        /usr/lib64/libgtk4-layer-shell.so \
        /usr/local/lib/libgtk4-layer-shell.so; do
        if [[ -r "${candidate}" ]]; then
            printf '%s\n' "${candidate}"
            return 0
        fi
    done

    return 1
}

run_probe_binary() {
    local preload

    preload="$(gtk4_layer_shell_preload || true)"
    if [[ -n "${preload}" ]]; then
        if [[ -n "${LD_PRELOAD:-}" ]]; then
            LD_PRELOAD="${preload}:${LD_PRELOAD}" "${VIVID_WAYLAND_PROBE}" "$@"
        else
            LD_PRELOAD="${preload}" "${VIVID_WAYLAND_PROBE}" "$@"
        fi
        return $?
    fi

    "${VIVID_WAYLAND_PROBE}" "$@"
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

    run_probe_binary "$@"
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
