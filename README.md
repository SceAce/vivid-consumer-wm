# Vivid

<p align="center">
  <img src="producer/resources/io.github.ayasa520.Vivid.svg" alt="Vivid thumbnail" width="160">
</p>

Vivid is an open-source reimplementation of Wallpaper Engine for Linux.

**THIS PROJECT USES VIBE CODING.**

## Build

Build artifacts are written under `producer/.build`.

### Flatpak

```sh
tools/vivid.sh flatpak prefetch
tools/vivid.sh build flatpak
tools/vivid.sh flatpak run-appdir
```

`tools/vivid.sh flatpak prefetch` downloads and pins the Flatpak sources first.
After that, an offline/cached build can be run with:

```sh
VIVID_FLATPAK_DISABLE_DOWNLOAD=1 tools/vivid.sh build flatpak
```

The Flatpak manifest is rendered from
`producer/packaging/flatpak/io.github.ayasa520.Vivid.yml` into
`producer/.build/flatpak-manifest`. The bundle is written to
`producer/.build/io.github.ayasa520.Vivid-1.0.0.flatpak` by default.

Set the Flatpak software version with:

```sh
VIVID_FLATPAK_APP_VERSION=1.0.0 \
VIVID_FLATPAK_RELEASE_DATE=2026-06-18 \
  tools/vivid.sh build flatpak
```

Useful cache locations:

- `producer/.build/flatpak-builder-state`
- `producer/.build/flatpak-builder-state/ccache`
- `producer/.build/flatpak-native-cache/native-build`
- `producer/.build/flatpak-repo/vivid-producer`

### Direct Run

```sh
tools/vivid.sh build direct-run
tools/vivid.sh direct-run run
```

Direct-run artifacts stay in `producer/.build/direct-run`.

### Wayland Consumer

Vivid includes an experimental generic Wayland layer-shell consumer for
Hyprland, niri, and other compositors with compatible layer-shell behavior.

```sh
tools/vivid.sh build wayland
tools/vivid.sh consumer wayland build
tools/vivid.sh wayland run --probe
tools/vivid.sh wayland run --compositor hyprland
tools/vivid.sh wayland run --compositor niri
```

Wayland consumer artifacts stay in `consumer/wayland/.build`. The consumer
connects to the producer-owned `display-v1` socket and receives rendered frame
buffers; it does not parse wallpaper package formats itself. This keeps dynamic
wallpaper format support owned by the producer and preserves every format the
producer can render.

Required dependencies include `meson`, `ninja`, `gjs`, GTK 4 development files
and GI typelib, `gtk4-layer-shell-0`, the `Gtk4LayerShell-1.0` typelib, a
layer-shell compositor, the shared display consumer library, and a running Vivid
producer. See `consumer/wayland/README.md` for details, limitations, and manual
Hyprland/niri verification steps.

### Hyprland Pointer Bridge

Hyprland needs an extra plugin because the wallpaper layer-shell surfaces stay
input-transparent. The Wayland consumer still renders the wallpaper, but the
Hyprland plugin passively forwards pointer motion to the producer so Vivid can
drive pointer-reactive wallpapers without making the wallpaper windows accept
input.

Build, test, and install the plugin with:

```sh
bash tools/vivid.sh hyprland-plugin test
bash tools/vivid.sh hyprland-plugin install
```

Install keeps a stable library path for fresh Hyprland sessions and also prints
a unique reload copy for in-session reloads, which avoids same-path `dlopen`
cache reuse when loading updated plugin code.

Load the plugin before starting the Hyprland Wayland consumer. For fresh
Hyprland sessions, use the stable load command:

```sh
hyprctl plugin load "$HOME/.local/lib/vivid/hyprland/libvivid-hyprland-bridge.so"
```

For in-session development reloads, use the unique reload copy printed by the
install command instead of reusing the stable path.

Run the producer and Wayland consumer separately:

```sh
VIVID_POINTER_DEBUG=1 bash tools/vivid.sh direct-run run-producer
VIVID_POINTER_DEBUG=1 bash tools/vivid.sh wayland run --compositor hyprland
```

Verify plugin startup in:

```sh
cat "$XDG_RUNTIME_DIR/vivid/hyprland-plugin.log"
```

Expect the startup log to include `hash_ok=1 listener_registered=1`. With
pointer debug enabled and motion flowing, the log can also show
`mouse.move.enter`, `mouse.move.route`, and socket activity.

For the full install flow, config keys, and reload details, see
`consumer/hyprland-plugin/README.md`.

niri uses the Wayland consumer path directly and does not need the Hyprland
plugin:

```sh
VIVID_POINTER_DEBUG=1 bash tools/vivid.sh wayland run --compositor niri
```

### Clean

```sh
tools/vivid.sh clean flatpak
tools/vivid.sh clean direct-run
tools/vivid.sh clean wayland
```

Clean commands are guarded so build cleanup only removes repository-local
`.build` paths.

Credits:

1. [waywallen](https://github.com/waywallen)
