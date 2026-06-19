# Vivid Wayland Consumer Probe

This directory contains the first scaffold for `vivid-consumer-wayland`, a
generic Wayland/layer-shell display consumer intended for compositors such as
Hyprland and niri.

Task 1 is only a dependency and launch baseline. The probe does not connect to
the Vivid producer socket, parse wallpaper formats, or render frames.

## Build

```sh
tools/vivid.sh wayland build
```

Build output is kept under `consumer/wayland/.build` by default. Override it
with `VIVID_WAYLAND_BUILD_DIR` or `VIVID_WAYLAND_BUILD_ROOT` when needed.

By default Meson requires the GTK4 layer-shell development package:

- `gtk4-layer-shell-0` via pkg-config
- `Gtk4LayerShell-1.0` GObject introspection typelib for runtime use from GJS

For probe-only environments that need to validate the GJS/GTK scaffold before
the layer-shell package is installed, configure with:

```sh
tools/vivid.sh wayland build -Dlayer_shell=disabled
```

That fallback is not a functional layer-shell consumer path. It only disables
the build-time dependency check; the runtime probe will report that the GI
namespace is unavailable.

## Run

```sh
tools/vivid.sh wayland run --help
tools/vivid.sh wayland run --probe
```

`--help` prints usage without initializing GTK or requiring a producer socket.
`--probe` initializes GTK and attempts to import and initialize
`Gtk4LayerShell`.
