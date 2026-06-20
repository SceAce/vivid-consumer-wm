# Vivid Hyprland Plugin

This plugin forwards Hyprland pointer motion to the Vivid `display-v1` producer
without making Wayland wallpaper windows receive input. It is motion-only; button
and axis forwarding are intentionally disabled.

## Build and Test

```sh
bash tools/vivid.sh hyprland-plugin test
bash tools/vivid.sh hyprland-plugin build
```

## Install and Load

```sh
bash tools/vivid.sh hyprland-plugin install
```

Install keeps the stable library at the normal install path for fresh Hyprland
sessions and also creates a uniquely named reload copy for in-session
development reloads. The command output prints both exact paths and both load
commands.

With the default prefix, the stable library path is:

```sh
hyprctl plugin load "$HOME/.local/lib/vivid/hyprland/libvivid-hyprland-bridge.so"
```

Use that stable path after a Hyprland restart or from persistent config.

For in-session development reloads, use the unique reload copy printed by the
install command, under:

```sh
$HOME/.local/lib/vivid/hyprland/reload/libvivid-hyprland-bridge-<YYYYmmddHHMMSS>-<hash>.so
```

Loading a new unique path avoids Hyprland reusing old code from a previously
loaded `.so` path during `dlopen`.

The install command does not auto-load the plugin.

After loading, verify startup in:

```sh
$XDG_RUNTIME_DIR/vivid/hyprland-plugin.log
```

Expect the startup log to include:

```text
hash_ok=1 listener_registered=1
```

## Configuration

Hyprland config keys:

- `plugin:vivid:enabled` - enable pointer forwarding; default `true`.
- `plugin:vivid:pointer_motion` - forward pointer motion; default `true`.
- `plugin:vivid:pointer_button` - reserved; default `false`.
- `plugin:vivid:pointer_axis` - reserved; default `false`.
- `plugin:vivid:socket` - Vivid `display-v1` socket path. Empty uses
  `$XDG_RUNTIME_DIR/vivid/display-v1.sock`.
- `plugin:vivid:output_map` - runtime output map path. Empty uses
  `$XDG_RUNTIME_DIR/vivid/outputs.json`.
- `plugin:vivid:required_hash` - required Hyprland ABI hash. The build-time
  value is used by default.
- `plugin:vivid:log_level` - plugin debug verbosity; set to `debug` to emit
  pointer debug lines during startup and pointer routing. Logs are appended to
  `$XDG_RUNTIME_DIR/vivid/hyprland-plugin.log` when that runtime path is
  available, with `stderr` as the fallback. `VIVID_POINTER_DEBUG=1` also
  enables these logs for ad-hoc runs and tests. Default `info`.

The Wayland consumer writes `outputs.json` after the producer accepts output
registrations. If the map file is missing or invalid, the plugin clears its map
and drops pointer forwarding until a valid map is available.
