#!/usr/bin/env bash

set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
    echo "Error: this script should not be run as root" >&2
    exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../../consumer/wayland" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
. "${SCRIPT_DIR}/build_env.sh"

usage() {
    cat <<'EOF'
Usage: tools/vivid.sh wayland {build|clean|run}

Actions:
  build [meson-options...]  Configure and build the Wayland layer-shell consumer.
  run [consumer-args...]    Run the consumer executable. Use --help for help.
EOF
}

consumer_usage() {
    if [[ ! -x "${VIVID_WAYLAND_CONSUMER}" ]]; then
        build
    fi

    "${VIVID_WAYLAND_CONSUMER}" --help
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
    chmod +x "${VIVID_WAYLAND_CONSUMER}"
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

run_consumer_binary() {
    local preload
    local display_consumer_dir="${VIVID_DISPLAY_CONSUMER_DIR:-${REPO_ROOT}/consumer/gnome/.build/src/display_consumer}"

    preload="$(gtk4_layer_shell_preload || true)"
    if [[ -d "${display_consumer_dir}" ]]; then
        export VIVID_DISPLAY_CONSUMER_DIR="${display_consumer_dir}"
        export GI_TYPELIB_PATH="${display_consumer_dir}${GI_TYPELIB_PATH:+:${GI_TYPELIB_PATH}}"
        export LD_LIBRARY_PATH="${display_consumer_dir}${LD_LIBRARY_PATH:+:${LD_LIBRARY_PATH}}"
    fi

    if [[ -n "${preload}" ]]; then
        if [[ -n "${LD_PRELOAD:-}" ]]; then
            LD_PRELOAD="${preload}:${LD_PRELOAD}" "${VIVID_WAYLAND_CONSUMER}" "$@"
        else
            LD_PRELOAD="${preload}" "${VIVID_WAYLAND_CONSUMER}" "$@"
        fi
        return $?
    fi

    "${VIVID_WAYLAND_CONSUMER}" "$@"
}

run_consumer() {
    case "${1:-}" in
        --help|-h)
            consumer_usage
            return 0
            ;;
    esac

    if [[ ! -x "${VIVID_WAYLAND_CONSUMER}" ]]; then
        build
    fi

    run_consumer_binary "$@"
}

case "${1:-help}" in
    build)
        shift
        build "$@"
        ;;
    run)
        shift
        run_consumer "$@"
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
