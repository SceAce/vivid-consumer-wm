#!/usr/bin/env sh
set -eu

SOURCE_DIR=$1
REPO_ROOT=$(CDPATH= cd -- "$SOURCE_DIR/../.." && pwd)
TMP_ROOT=${TMPDIR:-/tmp}/vivid-hyprland-install-test.$$
FAKE_BIN=$TMP_ROOT/bin
TEST_HOME=$TMP_ROOT/home
TEST_PREFIX=$TEST_HOME/.local
TEST_INSTALL_DIR=$TEST_PREFIX/lib/vivid/hyprland
OUTPUT_FILE=$TMP_ROOT/install-output.txt

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT INT TERM

mkdir -p "$FAKE_BIN" "$TEST_HOME" "$TEST_INSTALL_DIR"

cat >"$FAKE_BIN/meson" <<'EOF'
#!/usr/bin/env sh
set -eu

cmd=$1
shift

case "$cmd" in
  setup)
    build_dir=$1
    mkdir -p "$build_dir"
    : >"$build_dir/build.ninja"
    ;;
  install)
    installed_lib=$PLUGIN_INSTALL_DIR/libvivid-hyprland-bridge.so
    mkdir -p "$PLUGIN_INSTALL_DIR"
    printf '%s\n' 'fake-plugin-binary' >"$installed_lib"
    ;;
  *)
    exit 0
    ;;
esac
EOF
chmod +x "$FAKE_BIN/meson"

PATH=$FAKE_BIN:$PATH \
HOME=$TEST_HOME \
VIVID_HYPRLAND_PLUGIN_PREFIX=$TEST_PREFIX \
PLUGIN_INSTALL_DIR=$TEST_INSTALL_DIR \
sh "$REPO_ROOT/tools/consumer_hyprland_plugin/run.sh" install >"$OUTPUT_FILE"

INSTALLED_LIB=$TEST_INSTALL_DIR/libvivid-hyprland-bridge.so
RELOAD_DIR=$TEST_INSTALL_DIR/reload

[ -f "$INSTALLED_LIB" ]
[ -d "$RELOAD_DIR" ]

reload_matches=$(find "$RELOAD_DIR" -maxdepth 1 -type f -name 'libvivid-hyprland-bridge-*.so' | wc -l | tr -d ' ')
[ "$reload_matches" = "1" ]

RELOAD_LIB=$(find "$RELOAD_DIR" -maxdepth 1 -type f -name 'libvivid-hyprland-bridge-*.so' | head -n 1)
[ -f "$RELOAD_LIB" ]

reload_base=$(basename "$RELOAD_LIB")
case "$reload_base" in
  libvivid-hyprland-bridge-[0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9][0-9]-*.so)
    ;;
  *)
    echo "unexpected reload library name: $reload_base" >&2
    exit 1
    ;;
esac

cmp "$INSTALLED_LIB" "$RELOAD_LIB"

grep -F "Installed stable library: $INSTALLED_LIB" "$OUTPUT_FILE"
grep -F "Fresh-session load command:" "$OUTPUT_FILE"
grep -F "hyprctl plugin load $INSTALLED_LIB" "$OUTPUT_FILE"
grep -F "Runtime reload command:" "$OUTPUT_FILE"
grep -F "hyprctl plugin load $RELOAD_LIB" "$OUTPUT_FILE"
