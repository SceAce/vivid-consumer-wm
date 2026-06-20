#!/usr/bin/env sh
set -eu

SOURCE_DIR=$1
REPO_ROOT=$(CDPATH= cd -- "$SOURCE_DIR/../../.." && pwd)
TMP_ROOT=${TMPDIR:-/tmp}/vivid-systemd-user-test.$$
FAKE_BIN=$TMP_ROOT/bin
TEST_HOME=$TMP_ROOT/home
TEST_UNIT_DIR=$TEST_HOME/.config/systemd/user
OUTPUT_FILE=$TMP_ROOT/install-output.txt
START_OUTPUT_FILE=$TMP_ROOT/start-output.txt
STATUS_OUTPUT_FILE=$TMP_ROOT/status-output.txt
LOGS_OUTPUT_FILE=$TMP_ROOT/logs-output.txt

cleanup() {
  rm -rf "$TMP_ROOT"
}
trap cleanup EXIT INT TERM

mkdir -p "$FAKE_BIN" "$TEST_HOME"

cat >"$FAKE_BIN/systemctl" <<'EOF'
#!/usr/bin/env sh
set -eu
printf 'systemctl %s\n' "$*"
EOF
chmod +x "$FAKE_BIN/systemctl"

cat >"$FAKE_BIN/journalctl" <<'EOF'
#!/usr/bin/env sh
set -eu
printf 'journalctl %s\n' "$*"
EOF
chmod +x "$FAKE_BIN/journalctl"

PATH=$FAKE_BIN:$PATH \
HOME=$TEST_HOME \
VIVID_SYSTEMD_USER_DIR=$TEST_UNIT_DIR \
bash "$REPO_ROOT/tools/systemd_user/install.sh" install >"$OUTPUT_FILE"

[ -f "$TEST_UNIT_DIR/vivid-producer.service" ]
[ -f "$TEST_UNIT_DIR/vivid-webui.service" ]
[ -f "$TEST_UNIT_DIR/vivid-wayland-hyprland.service" ]
[ -f "$TEST_UNIT_DIR/vivid-hyprland.target" ]

grep -F "WorkingDirectory=$REPO_ROOT" "$TEST_UNIT_DIR/vivid-producer.service"
grep -F "Environment=VIVID_POINTER_DEBUG=1" "$TEST_UNIT_DIR/vivid-producer.service"
grep -F "ExecStart=/usr/bin/env bash $REPO_ROOT/tools/vivid.sh direct-run run-producer" "$TEST_UNIT_DIR/vivid-producer.service"

grep -F "Environment=VIVID_WEBUI_HOST=127.0.0.1" "$TEST_UNIT_DIR/vivid-webui.service"
grep -F "Environment=VIVID_WEBUI_PORT=8765" "$TEST_UNIT_DIR/vivid-webui.service"
grep -F "ExecStart=/usr/bin/env bash $REPO_ROOT/tools/vivid.sh direct-run run-webui" "$TEST_UNIT_DIR/vivid-webui.service"

grep -F "ExecStart=/usr/bin/env bash $REPO_ROOT/tools/vivid.sh wayland run --compositor hyprland" "$TEST_UNIT_DIR/vivid-wayland-hyprland.service"
grep -F "Wants=vivid-producer.service vivid-webui.service vivid-wayland-hyprland.service" "$TEST_UNIT_DIR/vivid-hyprland.target"
grep -F "systemctl --user daemon-reload" "$OUTPUT_FILE"
grep -F "tools/vivid.sh systemd-user start" "$OUTPUT_FILE"
grep -F "exec-once = systemctl --user start vivid-hyprland.target" "$OUTPUT_FILE"

PATH=$FAKE_BIN:$PATH \
HOME=$TEST_HOME \
VIVID_SYSTEMD_USER_DIR=$TEST_UNIT_DIR \
bash "$REPO_ROOT/tools/systemd_user/install.sh" --dry-run start >"$START_OUTPUT_FILE"
grep -F "DRY-RUN: systemctl --user start vivid-hyprland.target" "$START_OUTPUT_FILE"

PATH=$FAKE_BIN:$PATH \
HOME=$TEST_HOME \
VIVID_SYSTEMD_USER_DIR=$TEST_UNIT_DIR \
bash "$REPO_ROOT/tools/systemd_user/install.sh" --dry-run status >"$STATUS_OUTPUT_FILE"
grep -F "DRY-RUN: systemctl --user status vivid-hyprland.target vivid-producer.service vivid-webui.service vivid-wayland-hyprland.service" "$STATUS_OUTPUT_FILE"

PATH=$FAKE_BIN:$PATH \
HOME=$TEST_HOME \
VIVID_SYSTEMD_USER_DIR=$TEST_UNIT_DIR \
bash "$REPO_ROOT/tools/systemd_user/install.sh" --dry-run logs >"$LOGS_OUTPUT_FILE"
grep -F "DRY-RUN: journalctl --user -u vivid-hyprland.target -u vivid-producer.service -u vivid-webui.service -u vivid-wayland-hyprland.service -n 200 --no-pager" "$LOGS_OUTPUT_FILE"
