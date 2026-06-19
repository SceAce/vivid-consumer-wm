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
