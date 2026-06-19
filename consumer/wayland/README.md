# Vivid Wayland Consumer

This directory contains the experimental `vivid-consumer-wayland`, a generic
Wayland layer-shell display consumer for compositors such as Hyprland and niri.
It creates one background wallpaper surface per monitor, connects to the Vivid
`display-v1` producer socket, advertises DMA-BUF import capabilities, and
presents frames through the shared display consumer library.

The consumer does not parse wallpaper package formats. Format ownership remains
with the producer, so the Wayland consumer preserves all dynamic wallpaper
formats the producer already supports by receiving rendered frame buffers over
the producer-owned display protocol.

## Dependencies

Required to build and run the functional layer-shell consumer:

- `bash`
- `meson`
- `ninja`
- `gjs`
- GTK 4 development files and GObject introspection typelib
- `gtk4-layer-shell-0` development files through pkg-config
- `Gtk4LayerShell-1.0` GObject introspection typelib at runtime
- A Wayland compositor with layer-shell support, currently tested manually on
  Hyprland and niri
- The GNOME display consumer library built in `consumer/gnome/.build`, or a
  custom `VIVID_DISPLAY_CONSUMER_DIR` pointing at its generated GI typelib and
  shared library
- A running Vivid producer exposing the `display-v1` socket

For dependency probing only, configure with `-Dlayer_shell=disabled`. That mode
allows the GJS/GTK scaffold to build when the layer-shell development package is
missing, but it is not a functional wallpaper path.

## Build

```sh
tools/vivid.sh wayland build
tools/vivid.sh consumer wayland build
tools/vivid.sh build wayland
```

All three commands dispatch to the same Wayland build. Build output is kept
under `consumer/wayland/.build` by default. Override it with
`VIVID_WAYLAND_BUILD_DIR` or `VIVID_WAYLAND_BUILD_ROOT` when needed.

The build can also pass Meson options through to the Wayland consumer:

```sh
tools/vivid.sh wayland build -Dlayer_shell=disabled
```

## Run

```sh
tools/vivid.sh wayland run --help
tools/vivid.sh wayland run --probe
tools/vivid.sh wayland run --compositor hyprland
tools/vivid.sh wayland run --compositor niri
```

Normal runs connect to `${XDG_RUNTIME_DIR}/vivid/display-v1.sock` by default.
Use `--socket PATH` to point at another producer socket. `--compositor auto` is
the default, with explicit `generic`, `hyprland`, and `niri` modes available for
manual compositor verification.

The launcher automatically uses `consumer/gnome/.build/src/display_consumer` for
the shared display consumer library when it exists. If that library lives
elsewhere, set:

```sh
VIVID_DISPLAY_CONSUMER_DIR=/path/to/display_consumer \
  tools/vivid.sh wayland run --compositor hyprland
```

Clean only removes the guarded Wayland build tree:

```sh
tools/vivid.sh clean wayland
tools/vivid.sh wayland clean
```

The top-level clean guard refuses to remove a Wayland build path outside this
checkout or any path that is not a `.build` directory or below one.

## Current Limitations

- Pointer forwarding is not implemented. Wallpaper surfaces always set an empty
  input region and do not consume input; `--enable-pointer-events` is rejected.
- Media controls are not exposed by this consumer yet.
- Audio capture, audio forwarding, and audio-reactive integration are not
  enabled in the Wayland consumer yet.
- Hyprland and niri support is experimental and requires manual compositor
  verification because layer-shell behavior varies by compositor and monitor
  topology.

## Manual Verification

Before compositor-specific checks, build the producer/direct display pieces and
the Wayland consumer:

```sh
tools/vivid.sh build direct-run
tools/vivid.sh consumer gnome build
tools/vivid.sh build wayland
```

In a Hyprland session:

```sh
tools/vivid.sh direct-run run-producer
tools/vivid.sh wayland run --compositor hyprland
```

Verify that each monitor receives one `vivid-wallpaper` layer-shell surface,
the surface stays behind normal windows, the wallpaper updates when the producer
renders frames, and normal pointer/keyboard input continues to reach desktop
windows.

In a niri session:

```sh
tools/vivid.sh direct-run run-producer
tools/vivid.sh wayland run --compositor niri
```

Verify the same surface count, background placement, frame updates, and input
pass-through behavior. For both compositors, also run
`tools/vivid.sh wayland run --probe` to confirm the `Gtk4LayerShell` GI binding
imports and initializes before testing producer connectivity.
