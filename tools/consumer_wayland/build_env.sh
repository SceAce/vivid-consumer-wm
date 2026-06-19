#!/bin/sh

# Central path configuration for the generic Wayland consumer. Generated
# files stay under this consumer's .build tree unless the caller overrides the
# build root for packaging or CI.

: "${ROOT_DIR:?ROOT_DIR must be set before sourcing tools/consumer_wayland/build_env.sh}"

VIVID_WAYLAND_ROOT_DIR="${VIVID_WAYLAND_ROOT_DIR:-${ROOT_DIR}}"
VIVID_WAYLAND_BUILD_ROOT="${VIVID_WAYLAND_BUILD_ROOT:-${VIVID_WAYLAND_ROOT_DIR}/.build}"
VIVID_WAYLAND_BUILD_DIR="${VIVID_WAYLAND_BUILD_DIR:-${VIVID_WAYLAND_BUILD_ROOT}}"
VIVID_WAYLAND_INSTALL_PREFIX="${VIVID_WAYLAND_INSTALL_PREFIX:-${VIVID_WAYLAND_BUILD_ROOT}/install}"
VIVID_WAYLAND_CONSUMER="${VIVID_WAYLAND_CONSUMER:-${VIVID_WAYLAND_BUILD_DIR}/vivid-consumer-wayland}"
