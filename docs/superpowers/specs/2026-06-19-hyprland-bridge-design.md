# Vivid Hyprland Bridge Design

Date: 2026-06-19

## Goal

Add a Hyprland-specific bridge for Vivid features that cannot be implemented
reliably from a generic input-transparent layer-shell wallpaper window.

The bridge exists to support Wallpaper Engine interaction on Hyprland without
breaking desktop click-through behavior or destabilizing the DMA-BUF display
consumer. It complements the generic Wayland consumer; it does not replace the
producer, renderer modules, WebUI, or layer-shell display path.

## Current Evidence

The Wayland consumer already renders scene, video, and web wallpaper output by
receiving producer-owned `display-v1` frames. It deliberately uses an empty
input region so normal desktop pointer and keyboard events continue to reach
real application windows.

The attempted Hyprland pointer implementation polled cursor position from
outside the compositor. It worked briefly but caused file descriptor pressure in
real runtime, leading to DMA-BUF import failures such as `dup(fd=1023) failed`
and eventually wallpaper disappearance. Lowering polling frequency would only
reduce the probability of the failure; it would not fix the architecture.

Hyprland 0.55.3 is installed on the target system with headers under
`/usr/include/hyprland`. The local Hyprland version is:

- version: `0.55.3`
- tag: `v0.55.3`
- commit: `fe5fe79a29ac3adaf3e75560b2f4b7a6d58b31c9`
- ABI string:
  `fe5fe79a29ac3adaf3e75560b2f4b7a6d58b31c9_aq_0.12_hu_0.13_hg_0.5_hc_0.1_hlg_0.6`

Hyprland's plugin headers warn that C++ objects cross the plugin boundary and
ABI compatibility is not guaranteed. The plugin must be built against the
installed Hyprland headers for the current machine and must verify the running
Hyprland hash before doing useful work.

## Non-Goals

The bridge will not render wallpaper frames, import DMA-BUFs, parse Wallpaper
Engine projects, decode media, or host CEF. Those remain producer and renderer
responsibilities.

The bridge will not make the wallpaper layer receive input. The Wayland
consumer must keep an empty input region by default.

The bridge will not implement global keyboard capture. Keyboard forwarding is
outside the current Vivid display protocol, has higher privacy risk, and is not
required for the first Hyprland interaction milestone.

The Hyprland plugin will not perform MPRIS monitoring, audio capture, UPower
queries, or long-running desktop fact aggregation. Those are user-session
responsibilities and should not run inside the Hyprland compositor process.

The first bridge version targets Hyprland only. niri should use generic
user-session helpers and niri IPC where available; it should not share a
Hyprland plugin.

## Architecture

The bridge has two parts with different failure domains.

### Hyprland Plugin

Create a Hyprland plugin under:

```text
consumer/hyprland-plugin/
```

The plugin should build a shared object named:

```text
libvivid-hyprland-bridge.so
```

The plugin runs inside Hyprland and should remain intentionally small:

- export the required Hyprland plugin entry points;
- verify the running Hyprland hash and API version;
- subscribe to Hyprland input event signals through `Event::bus()`;
- transform compositor cursor coordinates into Vivid output coordinates;
- send compact `display-v1` pointer frames to the producer socket;
- return from event callbacks quickly;
- never cancel Hyprland input events.

The plugin must prefer Hyprland event signals over function hooks. Function
hooks are reserved for future cases where no public event exists and must not be
used for the first version.

### User-Session Desktop Facts Helper

Create a separate user-session helper in an independent implementation phase,
not inside the plugin:

```text
consumer/wayland-facts/
```

This helper owns compositor and desktop facts that are not input-event critical:

- Hyprland window state through Hyprland IPC socket2 plus targeted synchronous
  reads when needed;
- niri window state through niri IPC when implemented;
- MPRIS playback facts through D-Bus;
- battery and power facts through UPower;
- audio samples through PulseAudio or PipeWire/GStreamer.

It sends existing `display-v1` messages:

- `REQ_WINDOW_STATE`
- `REQ_MEDIA_STATE`
- `REQ_AUDIO_SAMPLES`

This split keeps compositor-process code small and keeps blocking I/O, D-Bus,
and audio pipelines in normal user processes where crashes do not take down the
window manager.

## Plugin Feature Scope

### Phase A: Pointer Motion

The first plugin release implements pointer motion only.

On Hyprland pointer motion:

1. Read the current compositor cursor position in global logical coordinates.
2. Find the monitor containing that position.
3. Convert the global logical coordinate into monitor-local logical coordinate.
4. Multiply by monitor scale to produce producer render-target coordinates.
5. Resolve the Vivid backend output id for that monitor.
6. Send `VIVID_DISPLAY_REQ_POINTER_MOTION` to the producer socket.

The event must be passive. It must not change focus, warp the cursor, grab the
seat, or cancel the original event.

Motion frames are latest-state signals. The plugin should coalesce motion per
output when the socket is backed up, matching the GNOME/KDE consumer behavior.

### Phase B: Button And Axis Events

Pointer button and wheel forwarding are useful for Wallpaper Engine projects
that react to clicks or scrolling, but they are more sensitive than motion.

Add them after motion is stable:

- `VIVID_DISPLAY_REQ_POINTER_BUTTON`
- `VIVID_DISPLAY_REQ_POINTER_AXIS`

They must be disabled by default and enabled by explicit plugin config. The
plugin must never prevent the same click or wheel event from reaching the real
desktop target.

Button and axis frames are ordering barriers. Motion coalescing must not reorder
or cross a button or wheel event.

### Phase C: Plugin Health And Discovery

The Wayland consumer should stop offering the unsafe polling path. Its
`--enable-pointer-events` flag should become a compatibility hint that either:

- verifies that the Hyprland plugin is loaded, or
- prints a clear message explaining that the plugin is required.

The producer or WebUI may later expose bridge status, but the first version can
rely on logs and `hyprctl plugins list`.

## Output Identity Contract

The plugin must send pointer frames for the same backend output ids that the
Wayland consumer registered with the producer.

The first implementation may use monitor name as the join key:

- Wayland consumer registers outputs with a stable display name where available.
- Hyprland plugin maps the current `PHLMONITOR` name to that output.

If monitor name is insufficient on a multi-monitor setup, add a tiny mapping
file under the runtime directory:

```text
$XDG_RUNTIME_DIR/vivid/outputs.json
```

The Wayland consumer writes the current output map atomically. The plugin reads
it opportunistically and keeps the last valid map in memory. Failure to read the
map disables pointer forwarding but must not affect wallpaper display.

## Configuration

The plugin should expose Hyprland plugin config keys under the `plugin:`
namespace.

Recommended keys:

- `plugin:vivid:enabled`, default `true`;
- `plugin:vivid:socket`, default `$XDG_RUNTIME_DIR/vivid/display-v1.sock`;
- `plugin:vivid:pointer_motion`, default `true`;
- `plugin:vivid:pointer_button`, default `false`;
- `plugin:vivid:pointer_axis`, default `false`;
- `plugin:vivid:required_hash`, default compiled Hyprland ABI string;
- `plugin:vivid:log_level`, default `info`.

The plugin must not call `hyprctl` or run shell commands from `pluginInit`.

## Desktop Facts Scope

Window, media, power, and audio facts should be handled outside the plugin.

### Window State

Hyprland can report window lifecycle and focus changes through IPC events. A
Wayland facts helper should consume those events and occasionally refresh a full
snapshot. It should send `display-window-state-v1` facts compatible with the
producer's existing policy evaluator:

- `windowFocused`
- `maximizedOrFullscreenOnAnyMonitor`
- `maximizedOrFullscreenOnAllMonitors`
- `coveredMonitorIndices`
- `visibleWindowCount`
- `applicationIdentifiers`
- `windows`

This enables the existing WebUI settings:

- pause on focus;
- pause on maximize or fullscreen;
- stop on configured applications.

### MPRIS, Power, And Audio Samples

MPRIS and power are D-Bus facts. Audio samples are a user-session capture path.
They should reuse the GNOME/KDE design shape, not the Hyprland plugin.

The facts helper may share code with the Wayland consumer or run as a sibling
process. It should advertise `media-state-v1` and `audio-samples-v1` only when
the relevant collectors are active.

## niri Position

niri should not use the Hyprland plugin. Its implementation path should be:

- generic Wayland layer-shell display consumer for frames;
- niri IPC or generic desktop portals for window state where available;
- D-Bus and audio user-session modules for media, power, and audio facts.

Any niri-specific logic belongs in the user-session facts helper or a niri
adapter, not in the Hyprland plugin.

## Failure Handling

The plugin must fail closed.

- If Hyprland hash validation fails, do not register input listeners.
- If the producer socket is unavailable, drop pointer events and retry later.
- If the output map is missing, drop pointer events and log once per interval.
- If a socket write fails, close the socket and reconnect later.
- If motion events arrive faster than they can be written, keep only the newest
  motion per output.

No plugin failure may affect frame rendering. The Wayland consumer must remain
usable without the plugin.

## Build And Install

Add script entry points:

```sh
tools/vivid.sh hyprland-plugin build
tools/vivid.sh hyprland-plugin install
tools/vivid.sh hyprland-plugin status
```

The build should use `pkg-config --cflags hyprland` and the system C++ compiler.
It should write artifacts under:

```text
consumer/hyprland-plugin/.build/
```

The install command may copy the shared object to a user-local Vivid plugin
directory and print the exact Hyprland config line the user should add. Automatic
Hyprland config mutation is not required for the first version.

## Verification

Minimum verification for Phase A:

1. Build the plugin against local Hyprland 0.55.3 headers.
2. Load it in Hyprland with `hyprctl plugin load`.
3. Run the producer and Wayland consumer without `--enable-pointer-events`.
4. Select an interactive Wallpaper Engine scene that reacts to mouse movement.
5. Move the cursor across the active monitor and confirm wallpaper interaction.
6. Keep the session running for at least ten minutes and confirm fd count does
   not grow without bound.
7. Confirm wallpaper frames continue rendering and no DMA-BUF `dup` exhaustion
   appears.
8. Confirm normal desktop clicks still reach application windows.
9. Confirm plugin unload stops pointer events without crashing Hyprland.

Minimum verification for Phase B:

1. Enable button and axis forwarding explicitly.
2. Confirm wallpaper clicks and wheel events work on a known interactive scene.
3. Confirm the same clicks and wheel events still reach real desktop windows.
4. Confirm motion coalescing does not reorder across click or wheel frames.

Minimum verification for desktop facts helper:

1. Open, focus, maximize, fullscreen, and close windows on Hyprland.
2. Confirm `REQ_WINDOW_STATE` facts update producer pause/stop policy.
3. Confirm MPRIS playback toggles pause policy when configured.
4. Confirm audio-reactive wallpapers receive nonzero samples when audio is
   playing.

## Risks

Hyprland plugin ABI is unstable across Hyprland builds. The plugin must be
treated as version-bound and rebuilt when Hyprland changes.

Running code inside Hyprland raises the cost of bugs. The plugin must stay small
and avoid blocking calls, threads with broad responsibilities, D-Bus, audio, and
complex JSON processing.

Output identity may be ambiguous on unusual monitor setups. The first version
can use monitor names, but the runtime output map should be added if verification
shows mismatches.

Button and wheel forwarding could surprise users if wallpaper interactions
trigger while they click desktop applications. Keeping those features explicit
and disabled by default limits the risk.

## Acceptance Criteria

Phase A is accepted when:

- Hyprland pointer motion works without polling `hyprctl cursorpos`;
- the Wayland wallpaper surface remains input-transparent;
- the plugin verifies the Hyprland ABI before registering listeners;
- fd usage remains stable during normal pointer movement;
- wallpaper rendering continues without DMA-BUF `dup` exhaustion;
- the old polling path is disabled or clearly marked unsupported.

The broader bridge plan is accepted when:

- pointer motion lives in the Hyprland plugin;
- button and axis forwarding are explicit opt-in plugin features;
- window, media, power, and audio facts live in a user-session helper;
- niri support does not depend on the Hyprland plugin;
- KDE and GNOME consumers continue using their existing desktop-integrated
  event paths.
