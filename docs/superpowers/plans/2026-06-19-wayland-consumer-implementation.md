# Wayland Consumer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `vivid-consumer-wayland`, a generic Wayland/layer-shell display consumer for Hyprland and niri that preserves all current producer-supported wallpaper formats.

**Architecture:** Add a new `consumer/wayland` target that reuses the existing `display-v1` protocol codec and `VividDisplayConsumer` GTK4/GDK DMA-BUF paintable library. The Wayland consumer owns compositor integration only: layer-shell surfaces, output enumeration, socket connection orchestration, and runtime scripts.

**Tech Stack:** Meson, GJS, GTK4, GDK Wayland, `gtk4-layer-shell` GObject introspection bindings or equivalent GTK4 layer-shell binding, GLib/GIO, existing Vivid display protocol and display consumer C library.

---

## Controller Rules

The controller agent does not write implementation code. It owns decisions,
task dispatch, code review, and verification.

Each implementation task must be delegated to a worker. Workers must:

- edit files directly in their forked workspace;
- use test-first development where the task changes behavior;
- not revert user or other-worker changes;
- commit their own task when complete;
- report changed files, commands run, and any concerns.

After each worker task, the controller must:

- inspect `git diff` or task commit;
- run the task's verification commands when possible;
- perform spec-compliance review before code-quality review;
- reject or request fixes for Critical or Important issues;
- only proceed when the task meets its acceptance criteria.

## Planned File Structure

Expected new files:

- `consumer/wayland/README.md`  
  User-facing build/run notes for the generic Wayland consumer.

- `consumer/wayland/meson.build`  
  Builds the Wayland consumer and reuses the existing protocol/display consumer
  sources without changing the KDE or GNOME targets.

- `consumer/wayland/meson_options.txt`  
  Optional feature flags for layer-shell dependency selection and install paths.

- `consumer/wayland/src/`  
  GJS runtime source for the Wayland consumer. Keep files split by
  responsibility: argument parsing, output model, layer-shell window creation,
  display-v1 connection, and app lifecycle. Do not introduce a new C display
  runtime unless the controller approves a design change after the layer-shell
  probe proves GJS bindings are unusable.

- `consumer/wayland/tests/`  
  Unit tests for argument parsing, output payload construction, protocol
  feature advertisement, and reconnect/topology state transitions that can run
  without a live compositor.

- `tools/consumer_wayland/build_env.sh`  
  Central path and install defaults, matching the GNOME/KDE script pattern.

- `tools/consumer_wayland/run.sh`  
  `build`, `run`, `install`, and `log` actions for direct development.

Expected modified files:

- `tools/vivid.sh`  
  Add `wayland` and `consumer wayland` top-level dispatch, completion, build,
  and clean support.

- `README.md`  
  Add a short experimental Wayland consumer build/run section.

Files that should not be changed in the first pass unless a review explicitly
approves it:

- `producer/src/daemon/vivid_producer.c`
- `producer/src/renderers/**`
- `consumer/kde/**`
- `consumer/gnome/extension/**`

## Task 1: Baseline And Dependency Probe

**Files:**
- Create: `consumer/wayland/README.md`
- Create: `consumer/wayland/meson.build`
- Create: `consumer/wayland/meson_options.txt`
- Create: `consumer/wayland/src/layer-shell-probe.js`
- Create: `tools/consumer_wayland/build_env.sh`
- Create: `tools/consumer_wayland/run.sh`
- Modify: `tools/vivid.sh`

- [ ] **Step 1: Establish baseline commands**

Run:

```sh
git status --short
tools/vivid.sh build gnome
tools/vivid.sh build kde
```

Expected:

- The worktree has no unrelated uncommitted changes.
- Existing GNOME and KDE consumer builds either pass, or failures are recorded
  as pre-existing environment/dependency failures before any code is changed.

- [ ] **Step 2: Add a minimal failing build target**

Add a `wayland` dispatch in `tools/vivid.sh` that calls
`tools/consumer_wayland/run.sh build`.

Run:

```sh
tools/vivid.sh wayland build
```

Expected:

- Fails because `tools/consumer_wayland/run.sh` or the Meson project does not
  exist yet. This is the RED check for the new top-level build entry.

- [ ] **Step 3: Implement only enough build scaffolding for a probe executable**

Create the `consumer/wayland` Meson project and a minimal GJS probe executable
that does not connect to the producer. The probe should initialize GTK and
attempt to import and initialize the selected GTK4 layer-shell introspection
namespace. If layer-shell is unavailable at build time, Meson must fail with a
clear dependency message unless a documented probe-only fallback option is
enabled.

Run:

```sh
tools/vivid.sh wayland build
```

Expected:

- Passes when GTK4 and the selected GTK4 layer-shell dependency are installed.
- Fails with a clear dependency error when the layer-shell dependency is not
  installed.

- [ ] **Step 4: Add direct run action**

Add:

```sh
tools/vivid.sh wayland run
```

It should run the probe executable with optional passthrough arguments.

Run:

```sh
tools/vivid.sh wayland run --help
```

Expected:

- Prints probe/runtime help text and exits successfully without requiring a
  producer socket.

- [ ] **Step 5: Commit**

```sh
git add consumer/wayland tools/consumer_wayland tools/vivid.sh
git commit -m "feat: add Wayland consumer build probe"
```

## Task 2: Runtime Model And Testable Protocol Payloads

**Files:**
- Create/Modify: `consumer/wayland/src/*`
- Create: `consumer/wayland/tests/*`
- Modify: `consumer/wayland/meson.build`

- [ ] **Step 1: Write tests for argument parsing**

Tests must cover:

- default socket path is `$XDG_RUNTIME_DIR/vivid/display-v1.sock`;
- `--socket PATH` overrides the path;
- default compositor mode is `auto`;
- supported compositor modes are `auto`, `generic`, `hyprland`, and `niri`;
- input is disabled by default;
- `--enable-pointer-events` enables pointer feature advertisement.

Run:

```sh
tools/vivid.sh wayland build
meson test -C consumer/wayland/.build
```

Expected:

- Tests fail because parsing/runtime code is missing.

- [ ] **Step 2: Implement argument parsing**

Implement the minimal parsing module and help output to pass the tests.

Run:

```sh
meson test -C consumer/wayland/.build
tools/vivid.sh wayland run --help
```

Expected:

- Tests pass.
- Help text documents `--socket`, `--compositor`, `--no-input`, and
  `--enable-pointer-events`.

- [ ] **Step 3: Write tests for protocol feature advertisement**

Tests must verify:

- `REQ_HELLO` client name identifies the Wayland consumer;
- media and audio features are not advertised in the first version;
- pointer feature is advertised only when enabled;
- DMA-BUF, explicit sync, bind-failed, unbind-done, and shadow-copy features
  are advertised.

Expected RED:

- Tests fail because payload builder code is missing.

- [ ] **Step 4: Implement payload builders**

Implement testable builders for hello, consumer caps, and output registration
payloads. The code must not require a live Wayland compositor for these tests.

Run:

```sh
meson test -C consumer/wayland/.build
```

Expected:

- All tests pass.

- [ ] **Step 5: Commit**

```sh
git add consumer/wayland
git commit -m "feat: add Wayland consumer runtime payload model"
```

## Task 3: Layer-Shell Output Surfaces

**Files:**
- Modify/Create: `consumer/wayland/src/*`
- Modify: `consumer/wayland/meson.build`
- Test: `consumer/wayland/tests/*`

- [ ] **Step 1: Write tests for output model conversion**

Tests must cover conversion from a compositor/GDK monitor model to
`display-v1` output registration:

- logical width and height;
- physical width and height using scale;
- monitor index;
- transform defaulting to normal;
- refresh rate defaulting safely when unavailable;
- desktop field set to `wayland-layer-shell`.

Expected RED:

- Tests fail because output conversion is missing.

- [ ] **Step 2: Implement output model conversion**

Implement conversion without creating live GTK windows.

Run:

```sh
meson test -C consumer/wayland/.build
```

Expected:

- Output model tests pass.

- [ ] **Step 3: Implement layer-shell surface creation**

Create one GTK window per monitor with:

- layer-shell namespace `vivid-wallpaper`;
- background layer, with bottom as a controlled fallback if the library exposes
  no background enum;
- all-edge anchors;
- exclusive zone 0;
- no keyboard interactivity;
- empty input region unless pointer events are explicitly enabled;
- `Gtk.Picture` displaying a `VividDisplayConsumer.BufferPaintable` or the C
  equivalent.

Run:

```sh
tools/vivid.sh wayland build
tools/vivid.sh wayland run --compositor generic --help
```

Expected:

- Build passes.
- Help still works.

- [ ] **Step 4: Manual compositor probe**

When a Hyprland or niri session is available, run:

```sh
tools/vivid.sh wayland run --compositor generic
```

Expected:

- One wallpaper-layer surface appears per output.
- Normal windows remain above it.
- The surface does not steal input.

If no compositor session is available in the execution environment, record this
as an unverified manual check rather than faking the result.

- [ ] **Step 5: Commit**

```sh
git add consumer/wayland
git commit -m "feat: create Wayland layer-shell wallpaper surfaces"
```

## Task 4: Display-V1 Connection And Frame Presentation

**Files:**
- Modify/Create: `consumer/wayland/src/*`
- Modify: `consumer/wayland/meson.build`
- Test: `consumer/wayland/tests/*`

- [ ] **Step 1: Write tests for connection state transitions**

Tests must cover:

- startup queues hello, caps, then output registration;
- socket close clears imported output state;
- reconnect re-sends hello, caps, and outputs;
- topology rebuild clears outputs before reconnecting.

Expected RED:

- Tests fail because connection state logic is missing.

- [ ] **Step 2: Implement producer socket client**

Implement connection to the producer socket using the existing protocol codec.
Handle:

- async or non-blocking reads;
- queued writes;
- reconnect delay;
- `EVT_OUTPUT_ACCEPTED`;
- `EVT_BIND_BUFFERS`;
- `EVT_SET_CONFIG`;
- `EVT_FRAME_READY`;
- `EVT_UNBIND`;
- `EVT_ERROR`.

Run:

```sh
meson test -C consumer/wayland/.build
tools/vivid.sh wayland build
```

Expected:

- Unit tests pass.
- Build passes.

- [ ] **Step 3: Wire frame events to paintables**

Use the existing `VividDisplayConsumer` buffer paintable/import path. Do not
write new format parsing or renderer code. Frame handling must mirror the GNOME
helper's accepted generation/config/frame-ready/unbind ordering.

Run:

```sh
tools/vivid.sh wayland build
```

Expected:

- Build passes.

- [ ] **Step 4: Integration smoke test**

When a Wayland compositor and Vivid producer are available, run:

```sh
tools/vivid.sh direct-run run-producer
tools/vivid.sh wayland run
```

Expected:

- The Wayland consumer connects to the default display socket.
- At least one currently supported wallpaper renders.
- Restarting the producer does not require restarting the consumer.

If the environment cannot run a compositor or producer, record the skipped
integration check with the exact missing dependency.

- [ ] **Step 5: Commit**

```sh
git add consumer/wayland
git commit -m "feat: connect Wayland consumer to display-v1 producer"
```

## Task 5: Top-Level Tooling And Documentation

**Files:**
- Modify: `tools/vivid.sh`
- Modify: `README.md`
- Modify: `consumer/wayland/README.md`
- Modify/Create: `tools/consumer_wayland/*`

- [ ] **Step 1: Write script behavior checks**

Add shell-level checks where practical, or document manual checks if the
repository has no shell test framework. Required checks:

- `tools/vivid.sh build wayland` dispatches to the Wayland build.
- `tools/vivid.sh consumer wayland build` dispatches to the same build.
- `tools/vivid.sh clean wayland` removes only the Wayland `.build` path.
- bash completion includes `wayland` and Wayland actions.

Expected RED:

- Checks fail or manual command output shows missing dispatches.

- [ ] **Step 2: Complete top-level script integration**

Update usage text, completion, `build`, `clean`, `consumer`, and direct
`wayland` dispatch paths.

Run:

```sh
tools/vivid.sh help
tools/vivid.sh build wayland
tools/vivid.sh consumer wayland build
tools/vivid.sh clean wayland
tools/vivid.sh completion bash
```

Expected:

- Help and completion mention Wayland.
- Build dispatches work.
- Clean refuses to remove anything outside the Wayland `.build` path.

- [ ] **Step 3: Update documentation**

Document:

- experimental Hyprland/niri support;
- producer-owned format support;
- required dependencies;
- build/run commands;
- current limitations: pointer/media/audio optional or not yet enabled;
- manual verification steps for Hyprland and niri.

- [ ] **Step 4: Commit**

```sh
git add README.md consumer/wayland tools/consumer_wayland tools/vivid.sh
git commit -m "docs: document experimental Wayland consumer"
```

## Task 6: Final Verification Matrix

**Files:**
- Modify only if verification finds bugs in prior tasks.

- [ ] **Step 1: Run build verification**

Run:

```sh
tools/vivid.sh build wayland
tools/vivid.sh build gnome
tools/vivid.sh build kde
```

Expected:

- Wayland build passes.
- Existing GNOME and KDE builds remain unchanged or any environment failures are
  documented as pre-existing.

- [ ] **Step 2: Run unit tests**

Run:

```sh
meson test -C consumer/wayland/.build
```

Expected:

- All Wayland consumer tests pass.

- [ ] **Step 3: Run format smoke checks when runtime environment exists**

With a live producer and compositor, test one sample each:

- scene renderer;
- video renderer;
- web renderer.

Expected:

- All three render through the Wayland consumer without consumer-side
  format-specific code.

- [ ] **Step 4: Final review**

Controller dispatches or performs final review:

- spec compliance against
  `docs/superpowers/specs/2026-06-19-wayland-consumer-design.md`;
- code quality review for ownership boundaries, duplicate GNOME helper logic,
  lifetime management, fd ownership, and build-script safety;
- git history review to ensure implementation commits are focused.

Expected:

- No Critical or Important findings remain.
