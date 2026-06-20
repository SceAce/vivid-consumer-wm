#!/usr/bin/env sh
set -eu

. "$(dirname -- "$0")/build_env.sh"

action="${1:-build}"
if [ "$#" -gt 0 ]; then
  shift
fi

setup() {
  if [ -f "$PLUGIN_BUILD_DIR/build.ninja" ]; then
    meson setup "$PLUGIN_BUILD_DIR" "$PLUGIN_SRC_DIR" --prefix "$PLUGIN_INSTALL_PREFIX" --libdir lib --reconfigure "$@"
  else
    meson setup "$PLUGIN_BUILD_DIR" "$PLUGIN_SRC_DIR" --prefix "$PLUGIN_INSTALL_PREFIX" --libdir lib "$@"
  fi
}

runtime_reload_name() {
  timestamp=$(date +%Y%m%d%H%M%S)
  hash_value=

  if command -v sha256sum >/dev/null 2>&1; then
    hash_value=$(sha256sum "$1" | awk '{print substr($1, 1, 12)}')
  elif command -v shasum >/dev/null 2>&1; then
    hash_value=$(shasum -a 256 "$1" | awk '{print substr($1, 1, 12)}')
  elif command -v cksum >/dev/null 2>&1; then
    hash_value=$(cksum "$1" | awk '{print $1}')
  fi

  if [ -n "$hash_value" ]; then
    printf 'libvivid-hyprland-bridge-%s-%s.so\n' "$timestamp" "$hash_value"
  else
    printf 'libvivid-hyprland-bridge-%s.so\n' "$timestamp"
  fi
}

clean_build_dir() {
  absolute_build_dir=$(realpath -m "$PLUGIN_BUILD_DIR")
  absolute_src_dir=$(realpath -m "$PLUGIN_SRC_DIR")

  case "$absolute_build_dir" in
    "$absolute_src_dir"/.build|"$absolute_src_dir"/.build/*)
      ;;
    *)
      echo "Refusing to remove Hyprland plugin build dir outside source .build: $absolute_build_dir" >&2
      exit 1
      ;;
  esac

  rm -rf "$absolute_build_dir"
}

case "$action" in
  build)
    setup "$@"
    meson compile -C "$PLUGIN_BUILD_DIR"
    ;;
  test)
    setup
    meson test -C "$PLUGIN_BUILD_DIR" "$@"
    ;;
  install)
    setup
    meson install -C "$PLUGIN_BUILD_DIR"
    installed_lib="$PLUGIN_INSTALL_DIR/libvivid-hyprland-bridge.so"
    reload_dir="$PLUGIN_INSTALL_DIR/reload"
    mkdir -p "$reload_dir"
    reload_lib="$reload_dir/$(runtime_reload_name "$installed_lib")"
    cp "$installed_lib" "$reload_lib"
    echo "Installed stable library: $installed_lib"
    echo "Created runtime reload copy: $reload_lib"
    echo "Fresh-session load command:"
    echo "  hyprctl plugin load $installed_lib"
    echo "Runtime reload command:"
    echo "  hyprctl plugin load $reload_lib"
    echo "Optional unload example:"
    echo "  hyprctl plugin unload $installed_lib"
    echo "Verify log:"
    echo "  \$XDG_RUNTIME_DIR/vivid/hyprland-plugin.log"
    echo "Expected startup markers:"
    echo "  hash_ok=1 listener_registered=1"
    ;;
  clean)
    clean_build_dir
    ;;
  *)
    echo "usage: $0 {build|test|install|clean} [args...]" >&2
    exit 2
    ;;
esac
