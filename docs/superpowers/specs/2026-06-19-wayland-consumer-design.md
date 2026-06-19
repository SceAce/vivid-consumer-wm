# Vivid Wayland Consumer Design

Date: 2026-06-19

## Goal

Add a desktop-agnostic Wayland display consumer for Vivid that works on
Hyprland and niri first, while remaining suitable for other wlroots-style
compositors that support layer-shell.

The first version must preserve the wallpaper format coverage that the current
project already has. Format support remains producer-owned: scene, video, web,
and future renderer types continue to be loaded and rendered by the existing
producer and renderer modules. The new Wayland consumer only receives
`display-v1` frames and presents them as desktop wallpaper surfaces.

## Current Architecture

Vivid is already split into a producer and display consumers.

- `producer/` owns renderer selection, Wallpaper Engine scene rendering, video
  rendering, web rendering, configuration, and the controller WebUI.
- `consumer/kde/` embeds a Qt/QML display module inside a Plasma wallpaper
  package.
- `consumer/gnome/` installs a GNOME Shell extension plus a GTK4 display helper.
- `consumer/gnome/src/protocol` contains the `vivid-display-v1` codec.
- `consumer/gnome/src/display_consumer` contains reusable GTK4/GDK DMA-BUF
  import and paintable code.

The `display-v1` protocol already carries the data needed by a generic display
consumer:

- output registration and output updates;
- consumer DMA-BUF capability advertisement;
- DMA-BUF buffer binding through Unix fd passing;
- explicit acquire/release synchronization;
- frame-ready events;
- unbind acknowledgements;
- optional pointer, media state, and audio sample messages.

## Non-Goals

The Wayland consumer will not parse Wallpaper Engine projects, decode video,
embed CEF, or implement any wallpaper format logic. Those remain existing
producer responsibilities.

The first version will not add a new user-facing wallpaper configuration model.
It will use the same producer socket and producer state as KDE/GNOME consumers.

The first version will not guarantee compositor-specific polish beyond Hyprland
and niri. The implementation should be generic enough to test on sway/river
later, but they are not release blockers for the first version.

The first version will not make pointer interaction mandatory. Wallpaper input
will default to disabled so the wallpaper surface cannot steal desktop input.

## Recommended Shape

Create a new consumer target:

```text
consumer/wayland/
tools/consumer_wayland/
```

Expose it through the top-level script:

```sh
tools/vivid.sh wayland build
tools/vivid.sh wayland run
tools/vivid.sh wayland install
tools/vivid.sh wayland log
```

The installed runtime can be named `vivid-consumer-wayland`.

## Components

### Shared Display Library

Reuse the existing C display library from `consumer/gnome/src/display_consumer`
for the first version. It already handles the hardest display path:

- GDK DMA-BUF texture import;
- render-node probing;
- modifier and plane-count capability probing;
- explicit acquire fence waiting;
- release syncobj signaling;
- Vulkan shadow-copy relay for difficult GPU/compositor combinations;
- `GdkPaintable` presentation for GTK widgets.

This avoids reimplementing the synchronization and GPU interop path while
adding the compositor integration that Hyprland and niri need.

### Protocol Transport

Reuse `consumer/gnome/src/protocol` as the protocol codec.

The Wayland consumer should send the same core startup sequence as the GNOME
helper:

1. `REQ_HELLO` with role `consumer`.
2. `REQ_CONSUMER_CAPS` with DMA-BUF caps.
3. `REQ_REGISTER_OUTPUT` once per output.
4. Event handling for `EVT_OUTPUT_ACCEPTED`, `EVT_BIND_BUFFERS`,
   `EVT_SET_CONFIG`, `EVT_FRAME_READY`, `EVT_UNBIND`, and `EVT_ERROR`.
5. `REQ_UNBIND_DONE` after each accepted unbind.

The first version may keep media and audio messages disabled. It must not
advertise features that it does not send or handle.

### Layer-Shell Surface Backend

Use GTK4 plus a layer-shell integration library as the first implementation
route. The consumer already presents frames as a `Gtk.Picture` backed by a
`GdkPaintable`, so GTK4 keeps the code close to the GNOME helper.

Each output gets one layer-shell surface:

- layer: background, falling back to bottom if required by a compositor;
- anchor: all edges;
- exclusive zone: 0;
- keyboard interactivity: none;
- input region: empty by default;
- namespace: `vivid-wallpaper`;
- monitor/output: bound to the matching Wayland output.

If GTK4 layer-shell integration is unavailable on a target distribution, a
later implementation can add a pure Wayland backend. That is not part of the
first version unless the GTK4 route fails during verification.

### Output Discovery

Prefer a generic Wayland path first:

- enumerate outputs through Wayland/GDK;
- read geometry, scale, refresh rate, transform, and output identity where
  available;
- register one Vivid output per compositor output.

Add compositor adapters only where generic output data is insufficient:

- Hyprland adapter: use `hyprctl -j monitors` for richer monitor metadata and
  Hyprland socket2 for topology changes.
- niri adapter: start with generic Wayland output discovery. Add niri-specific
  IPC only if verification proves the generic path cannot provide stable output
  identity or topology changes.

For the first version, a topology change may rebuild the whole display
connection instead of applying precise incremental diffs. That is acceptable
because it keeps buffer lifetime and unbind handling simpler.

## Format Support Contract

The Wayland consumer is format-agnostic. It supports the same wallpaper formats
as the producer if all of the following are true:

1. The producer can load and render the selected project or file.
2. The producer emits `display-v1` buffer bindings and frame-ready events.
3. The Wayland consumer imports the advertised DMA-BUF buffers.
4. The layer-shell surface presents the resulting GTK paintable at the output
   size.

The first release must be validated with at least one sample from every renderer
route currently kept by the producer:

- scene renderer;
- video renderer;
- web renderer.

If a format fails only on the new consumer but works on KDE/GNOME, the bug is in
the Wayland consumer's display path, output registration, DMA-BUF caps, or sync
handling. It should not be solved by adding format-specific parsing to the
consumer.

## Runtime Behavior

Startup:

1. Resolve the display socket path, defaulting to
   `$XDG_RUNTIME_DIR/vivid/display-v1.sock`.
2. Initialize GTK and the layer-shell backend.
3. Enumerate outputs and create one wallpaper surface per output.
4. Connect to the producer socket.
5. Send hello, consumer caps, and output registrations.
6. Present frames as they arrive.

Reconnect:

- If the producer socket is unavailable, retry with a short fixed delay.
- If the socket closes, clear all imported buffers, keep layer-shell surfaces
  alive, and reconnect.
- If output topology changes, close the display connection, destroy surfaces,
  re-enumerate outputs, recreate surfaces, and reconnect.

Shutdown:

- Stop socket reads and writes.
- Signal or release any pending release syncobjs where possible.
- Clear imported DMA-BUF generations.
- Destroy layer-shell surfaces.

## Configuration

The first version should have a small config surface:

- `--socket PATH`;
- `--no-input`, default true;
- `--enable-pointer-events`, optional future behavior;
- `--compositor auto|generic|hyprland|niri`;
- `--log-level debug|info|warn`.

Configuration file support can come later. Command-line flags are enough for the
first version and for systemd user service integration.

## Open Questions And Verification Tasks

These are the uncertain parts to resolve before implementation is treated as
complete:

1. Confirm the selected GTK4 layer-shell library supports binding a window to a
   specific monitor/output in both Hyprland and niri.
2. Confirm niri places background or bottom layer-shell surfaces behind normal
   windows without requiring compositor-specific rules.
3. Confirm GDK output geometry and scale are stable enough on Hyprland and niri.
4. Confirm topology changes can be detected reliably through generic GDK/Wayland
   signals. If not, add compositor-specific adapters.
5. Confirm an empty input region prevents the wallpaper surface from stealing
   pointer and keyboard input on both compositors.
6. Confirm DMA-BUF direct import and shadow-copy paths work on at least one
   Intel/AMD system and record NVIDIA behavior if available.
7. Confirm scene, video, and web renderer outputs all present through the new
   consumer without format-specific code.

## Implementation Phases

### Phase 0: Layer-Shell Probe

Build a minimal GTK4 layer-shell executable that creates one full-output
wallpaper surface per monitor and paints a static color or test image.

Success criteria:

- Hyprland shows the surfaces as wallpaper-layer content.
- niri shows the surfaces as wallpaper-layer content.
- Normal windows remain above the surfaces.
- The surfaces do not receive input by default.

### Phase 1: Minimal Display-V1 Consumer

Create `consumer/wayland` and wire it to the existing protocol and display
consumer library. Implement producer connection, output registration, buffer
binding, frame presentation, unbind, and reconnect.

Success criteria:

- A currently supported scene wallpaper renders.
- A currently supported video wallpaper renders.
- A currently supported web wallpaper renders.
- Restarting the producer does not require restarting the Wayland consumer.

### Phase 2: Output Topology

Handle monitor add/remove, scale changes, and transform changes. Use full
connection rebuild first; add precise incremental updates only if needed.

Success criteria:

- Connecting or disconnecting a monitor eventually produces the correct number
  of wallpaper surfaces.
- No stale surface remains visible after an output disappears.
- The producer receives output dimensions matching compositor outputs.

### Phase 3: Packaging And Service

Add install/run/log scripts and an optional systemd user service.

Success criteria:

- `tools/vivid.sh wayland build` builds the consumer.
- `tools/vivid.sh wayland run` starts it in the current session.
- `tools/vivid.sh wayland install` installs the binary and service files for
  the current user or selected prefix.

### Phase 4: Optional Interaction Features

Add pointer forwarding, MPRIS media state, and audio sample forwarding after the
display path is stable.

Success criteria:

- Pointer forwarding is opt-in and never steals desktop input by default.
- Media and audio features are advertised only when active.

## Risks

The main risk is not wallpaper format support. The producer already owns that.
The main risks are compositor-layer behavior and GPU buffer import behavior.

Layer-shell behavior may differ between Hyprland and niri. This is contained by
the Phase 0 probe and by keeping compositor-specific adapters small.

DMA-BUF import can vary by GPU, driver, modifier support, and compositor. This
is contained by reusing the existing `VividDisplayConsumer` direct-import and
shadow-copy paths instead of writing a new importer.

Output identity can be unstable when relying only on generic GDK monitor
objects. This is contained by rebuilding the connection on topology changes for
the first version, and by adding Hyprland or niri adapters only where needed.

## Acceptance Criteria

The Wayland consumer is ready for a first experimental release when:

- it runs on Hyprland and niri;
- it displays scene, video, and web wallpapers already supported by the producer;
- it survives producer restart;
- it does not steal input by default;
- it handles monitor topology changes by rebuilding cleanly;
- it can be built and run through `tools/vivid.sh`;
- the KDE and GNOME consumers continue to build without behavior changes.

