# Hyprland Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build `libvivid-hyprland-bridge.so`, a small Hyprland plugin that forwards passive pointer events to Vivid's existing `display-v1` producer socket without making the wallpaper layer accept input.

**Architecture:** Keep compositor-process code minimal: Hyprland plugin entry points, ABI/hash validation, config values, event listeners, output mapping, and non-blocking socket writes. Reuse the existing Vivid binary protocol definitions where practical, and keep desktop facts, D-Bus, audio, and renderer logic outside the plugin.

**Tech Stack:** C++23, Meson, Hyprland 0.55.3 plugin API headers, `Event::bus()`, POSIX Unix sockets, existing `producer/src/protocol/vivid_display_protocol.h` constants, GJS tests for Wayland consumer flag behavior, and small C++ unit tests for plugin-local pure helpers.

---

## Controller Rules

The controller agent is the decision and review layer only. It must not write implementation code for product files. For every code task, dispatch a worker agent and instruct it to edit files directly in its forked workspace. Workers are not alone in the codebase: they must not revert user edits or other-worker edits, and they must adapt to existing changes.

After each worker returns, the controller must inspect the diff, run the task verification commands when available, perform spec-compliance review, then perform code-quality review. Reject or request fixes for Critical or Important issues.

Do not start implementation on `main` or `master` without explicit user consent. The current working branch observed while writing this plan is `feature/wayland-consumer`.

## Scope Decisions

Implement Phase A first: pointer motion only. Include compile-time and runtime structure for button and axis config keys, but do not forward button or axis events until motion is verified. This avoids introducing click semantics while the plugin ABI and output mapping are still new.

Do not put MPRIS, UPower, audio capture, niri support, renderer code, DMA-BUF import, or Wallpaper Engine parsing in this plugin. Those belong in existing producer/renderer code or in a later user-session facts helper.

Prefer `Event::bus()` listeners. Do not use `CFunctionHook` in this phase.

## Planned File Structure

Create:

- `consumer/hyprland-plugin/meson.build`  
  Builds the plugin shared module and unit/helper test binaries. It must use installed Hyprland headers from `/usr/include/hyprland` or a documented Meson option.

- `consumer/hyprland-plugin/meson_options.txt`  
  Defines `hyprland_include_dir`, `required_hash`, `default_socket`, and a test toggle if needed.

- `consumer/hyprland-plugin/src/plugin.cpp`  
  Hyprland plugin entry points, hash validation, config registration, event listener lifecycle, and top-level dispatch to helper classes.

- `consumer/hyprland-plugin/src/vivid_bridge.hpp`  
  Small interfaces and data structures used by plugin code: config snapshot, pointer packet type, output mapping type, and bridge ownership.

- `consumer/hyprland-plugin/src/vivid_protocol.hpp`  
  Header-only little-endian frame encoding for pointer motion. It should mirror existing protocol constants, not invent new opcodes.

- `consumer/hyprland-plugin/src/vivid_socket.hpp`
- `consumer/hyprland-plugin/src/vivid_socket.cpp`  
  Non-blocking Unix socket client with bounded queue and latest-motion coalescing per output.

- `consumer/hyprland-plugin/src/output_map.hpp`
- `consumer/hyprland-plugin/src/output_map.cpp`  
  Monitor-name to backend-output-id mapping. Start with monitor name and allow optional `$XDG_RUNTIME_DIR/vivid/outputs.json` support.

- `consumer/hyprland-plugin/src/pointer_mapper.hpp`
- `consumer/hyprland-plugin/src/pointer_mapper.cpp`  
  Pure coordinate conversion from Hyprland global logical coordinates and monitor geometry to Vivid render-target coordinates.

- `consumer/hyprland-plugin/tests/protocol_test.cpp`
- `consumer/hyprland-plugin/tests/output_map_test.cpp`
- `consumer/hyprland-plugin/tests/pointer_mapper_test.cpp`  
  Unit tests that do not require a running Hyprland compositor.

- `tools/consumer_hyprland_plugin/build_env.sh`
- `tools/consumer_hyprland_plugin/run.sh`  
  Direct build/test/install helper scripts following the existing `tools/consumer_wayland` style.

Modify:

- `tools/vivid.sh`  
  Add `hyprland-plugin` dispatch for `build`, `test`, `install`, and `clean`.

- `consumer/wayland/src/runtimeArgs.js`  
  Make `--enable-pointer-events` a compatibility request instead of enabling the old polling provider.

- `consumer/wayland/src/layer-shell-probe.js`  
  Remove runtime creation of `HyprlandPointerProvider`; print a clear message when pointer events are requested and the plugin is required.

- `consumer/wayland/meson.build`  
  Stop running old polling-specific tests once replacement behavior is covered.

- `consumer/wayland/tests/runtime-args.test.js`
- `consumer/wayland/tests/protocol-payloads.test.js`
- `consumer/wayland/tests/hyprland-pointer.test.js`  
  Replace unsafe polling expectations with plugin-required expectations. Delete `hyprland-pointer.test.js` only if no pure helpers remain in `consumer/wayland/src/hyprlandPointer.js`.

- `README.md`
- `consumer/wayland/README.md`  
  Document that Hyprland pointer forwarding requires the Hyprland plugin.

Do not modify in this implementation unless a review explicitly approves it:

- `producer/src/daemon/**`
- `producer/src/renderers/**`
- `consumer/gnome/**`
- `consumer/kde/**`

## Task 1: Hyprland Plugin API Probe And Build Skeleton

**Files:**
- Create: `consumer/hyprland-plugin/meson.build`
- Create: `consumer/hyprland-plugin/meson_options.txt`
- Create: `consumer/hyprland-plugin/src/plugin.cpp`
- Create: `tools/consumer_hyprland_plugin/build_env.sh`
- Create: `tools/consumer_hyprland_plugin/run.sh`
- Modify: `tools/vivid.sh`

- [ ] **Step 1: Record baseline**

Run:

```sh
git status --short
tools/vivid.sh wayland build
meson test -C consumer/wayland/.build
```

Expected:

- Worktree status is recorded before edits.
- Existing Wayland consumer build/test status is known before plugin work begins.

- [ ] **Step 2: Add failing top-level dispatch test**

Modify `tools/vivid.sh` so this command routes to `tools/consumer_hyprland_plugin/run.sh build`:

```sh
tools/vivid.sh hyprland-plugin build
```

Run:

```sh
tools/vivid.sh hyprland-plugin build
```

Expected: fails because `tools/consumer_hyprland_plugin/run.sh` and the plugin Meson project do not exist yet.

- [ ] **Step 3: Add Meson skeleton**

Create `consumer/hyprland-plugin/meson_options.txt`:

```meson
option('hyprland_include_dir', type: 'string', value: '/usr/include/hyprland', description: 'Installed Hyprland header root')
option('required_hash', type: 'string', value: '', description: 'Required Hyprland ABI hash. Empty means use compiled client hash.')
option('default_socket', type: 'string', value: '', description: 'Default Vivid display-v1 socket path. Empty means $XDG_RUNTIME_DIR/vivid/display-v1.sock.')
```

Create `consumer/hyprland-plugin/meson.build`:

```meson
project(
  'vivid-hyprland-bridge',
  'cpp',
  version: '0.1.0',
  license: 'GPL-3.0-or-later',
  meson_version: '>= 0.57.0',
  default_options: ['cpp_std=c++23']
)

cpp = meson.get_compiler('cpp')
hyprland_include_dir = get_option('hyprland_include_dir')
hyprland_inc = include_directories(hyprland_include_dir, hyprland_include_dir / 'src')
required_hash = get_option('required_hash')
default_socket = get_option('default_socket')

add_project_arguments(
  '-DVIVID_HYPRLAND_REQUIRED_HASH="@0@"'.format(required_hash),
  '-DVIVID_HYPRLAND_DEFAULT_SOCKET="@0@"'.format(default_socket),
  language: 'cpp'
)

shared_module(
  'vivid-hyprland-bridge',
  files('src/plugin.cpp'),
  include_directories: hyprland_inc,
  install: true,
  name_prefix: 'lib',
)
```

Create `consumer/hyprland-plugin/src/plugin.cpp` as the minimal compile probe:

```cpp
#include <src/plugins/PluginAPI.hpp>
#include <src/event/EventBus.hpp>
#include <src/devices/IPointer.hpp>

static HANDLE g_pluginHandle = nullptr;

APICALL EXPORT std::string PLUGIN_API_VERSION() {
    return HYPRLAND_API_VERSION;
}

APICALL EXPORT PLUGIN_DESCRIPTION_INFO PLUGIN_INIT(HANDLE handle) {
    g_pluginHandle = handle;
    const auto version = HyprlandAPI::getHyprlandVersion(handle);
    (void)version;
    (void)Event::bus()->m_events.input.mouse.move;
    (void)Event::bus()->m_events.input.mouse.button;
    (void)Event::bus()->m_events.input.mouse.axis;
    return {
        .name = "vivid-hyprland-bridge",
        .description = "Passive Vivid display-v1 pointer bridge for Hyprland",
        .author = "Vivid",
        .version = "0.1.0",
    };
}

APICALL EXPORT void PLUGIN_EXIT() {
    g_pluginHandle = nullptr;
}
```

- [ ] **Step 4: Add helper scripts**

Create `tools/consumer_hyprland_plugin/build_env.sh`:

```sh
#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(CDPATH= cd -- "$SCRIPT_DIR/../.." && pwd)
PLUGIN_SRC_DIR="$REPO_ROOT/consumer/hyprland-plugin"
PLUGIN_BUILD_DIR="$PLUGIN_SRC_DIR/.build"
PLUGIN_INSTALL_PREFIX="${VIVID_HYPRLAND_PLUGIN_PREFIX:-$HOME/.local}"

export REPO_ROOT PLUGIN_SRC_DIR PLUGIN_BUILD_DIR PLUGIN_INSTALL_PREFIX
```

Create `tools/consumer_hyprland_plugin/run.sh`:

```sh
#!/usr/bin/env sh
set -eu

. "$(dirname -- "$0")/build_env.sh"

action="${1:-build}"
if [ "$#" -gt 0 ]; then
  shift
fi

case "$action" in
  build)
    meson setup "$PLUGIN_BUILD_DIR" "$PLUGIN_SRC_DIR" --prefix "$PLUGIN_INSTALL_PREFIX" "$@" --reconfigure
    meson compile -C "$PLUGIN_BUILD_DIR"
    ;;
  test)
    meson setup "$PLUGIN_BUILD_DIR" "$PLUGIN_SRC_DIR" --prefix "$PLUGIN_INSTALL_PREFIX" --reconfigure
    meson test -C "$PLUGIN_BUILD_DIR" "$@"
    ;;
  install)
    meson setup "$PLUGIN_BUILD_DIR" "$PLUGIN_SRC_DIR" --prefix "$PLUGIN_INSTALL_PREFIX" --reconfigure
    meson install -C "$PLUGIN_BUILD_DIR"
    ;;
  clean)
    rm -rf "$PLUGIN_BUILD_DIR"
    ;;
  *)
    echo "usage: $0 {build|test|install|clean} [args...]" >&2
    exit 2
    ;;
esac
```

Set both scripts executable.

- [ ] **Step 5: Verify skeleton**

Run:

```sh
tools/vivid.sh hyprland-plugin build
```

Expected:

- Produces `consumer/hyprland-plugin/.build/libvivid-hyprland-bridge.so`.
- If the local Hyprland headers differ, the failure points at missing or changed Hyprland API symbols, not at missing project files.

- [ ] **Step 6: Commit**

```sh
git add consumer/hyprland-plugin tools/consumer_hyprland_plugin tools/vivid.sh
git commit -m "feat: add Hyprland bridge plugin skeleton"
```

## Task 2: Protocol Encoder And Socket Queue

**Files:**
- Create: `consumer/hyprland-plugin/src/vivid_protocol.hpp`
- Create: `consumer/hyprland-plugin/src/vivid_socket.hpp`
- Create: `consumer/hyprland-plugin/src/vivid_socket.cpp`
- Create: `consumer/hyprland-plugin/tests/protocol_test.cpp`
- Modify: `consumer/hyprland-plugin/meson.build`

- [ ] **Step 1: Write failing protocol tests**

Create `consumer/hyprland-plugin/tests/protocol_test.cpp`:

```cpp
#include "../src/vivid_protocol.hpp"

#include <cassert>
#include <cmath>
#include <cstdint>
#include <vector>

static uint16_t read_u16(const std::vector<uint8_t>& bytes, size_t offset) {
    return uint16_t(bytes[offset]) | (uint16_t(bytes[offset + 1]) << 8);
}

static uint32_t read_u32(const std::vector<uint8_t>& bytes, size_t offset) {
    return uint32_t(bytes[offset]) |
           (uint32_t(bytes[offset + 1]) << 8) |
           (uint32_t(bytes[offset + 2]) << 16) |
           (uint32_t(bytes[offset + 3]) << 24);
}

static uint64_t read_u64(const std::vector<uint8_t>& bytes, size_t offset) {
    return uint64_t(read_u32(bytes, offset)) |
           (uint64_t(read_u32(bytes, offset + 4)) << 32);
}

static double read_f64(const std::vector<uint8_t>& bytes, size_t offset) {
    double value = 0.0;
    uint8_t* out = reinterpret_cast<uint8_t*>(&value);
    for (size_t i = 0; i < sizeof(double); ++i)
        out[i] = bytes[offset + i];
    return value;
}

int main() {
    const auto frame = vivid::hyprland::encodePointerMotion(17, 15.5, 30.25, 123456789);
    assert(frame.size() == 32);
    assert(read_u16(frame, 0) == 7);
    assert(read_u16(frame, 2) == 32);
    assert(read_u32(frame, 4) == 17);
    assert(std::fabs(read_f64(frame, 8) - 15.5) < 0.00001);
    assert(std::fabs(read_f64(frame, 16) - 30.25) < 0.00001);
    assert(read_u64(frame, 24) == 123456789);
    return 0;
}
```

Wire it into Meson:

```meson
protocol_test = executable(
  'vivid-hyprland-protocol-test',
  files('tests/protocol_test.cpp'),
  include_directories: hyprland_inc,
)
test('protocol', protocol_test)
```

Run:

```sh
tools/vivid.sh hyprland-plugin test
```

Expected: fails because `vivid_protocol.hpp` does not exist.

- [ ] **Step 2: Implement pointer motion frame encoding**

Create `consumer/hyprland-plugin/src/vivid_protocol.hpp`:

```cpp
#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <stdexcept>
#include <vector>

namespace vivid::hyprland {

constexpr uint16_t REQ_POINTER_MOTION = 7;
constexpr size_t POINTER_MOTION_BODY_BYTES = 28;
constexpr size_t FRAME_HEADER_BYTES = 4;

inline void writeU16LE(std::vector<uint8_t>& out, size_t offset, uint16_t value) {
    out[offset] = uint8_t(value & 0xff);
    out[offset + 1] = uint8_t((value >> 8) & 0xff);
}

inline void writeU32LE(std::vector<uint8_t>& out, size_t offset, uint32_t value) {
    out[offset] = uint8_t(value & 0xff);
    out[offset + 1] = uint8_t((value >> 8) & 0xff);
    out[offset + 2] = uint8_t((value >> 16) & 0xff);
    out[offset + 3] = uint8_t((value >> 24) & 0xff);
}

inline void writeU64LE(std::vector<uint8_t>& out, size_t offset, uint64_t value) {
    writeU32LE(out, offset, uint32_t(value & 0xffffffffu));
    writeU32LE(out, offset + 4, uint32_t((value >> 32) & 0xffffffffu));
}

inline void writeF64LE(std::vector<uint8_t>& out, size_t offset, double value) {
    static_assert(__BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__, "Vivid protocol encoder expects little-endian host");
    std::memcpy(out.data() + offset, &value, sizeof(double));
}

inline std::vector<uint8_t> encodePointerMotion(uint32_t outputId, double x, double y, uint64_t timeUsec) {
    std::vector<uint8_t> frame(FRAME_HEADER_BYTES + POINTER_MOTION_BODY_BYTES);
    writeU16LE(frame, 0, REQ_POINTER_MOTION);
    writeU16LE(frame, 2, uint16_t(frame.size()));
    writeU32LE(frame, 4, outputId);
    writeF64LE(frame, 8, x);
    writeF64LE(frame, 16, y);
    writeU64LE(frame, 24, timeUsec);
    return frame;
}

}
```

Run:

```sh
tools/vivid.sh hyprland-plugin test
```

Expected: `protocol` test passes.

- [ ] **Step 3: Write failing queue tests**

Add a test executable `consumer/hyprland-plugin/tests/socket_queue_test.cpp` that constructs a test-only queue and proves:

```cpp
#include "../src/vivid_socket.hpp"

#include <cassert>

int main() {
    vivid::hyprland::SocketQueue queue;
    queue.enqueueMotion(17, {1, 1, 100});
    queue.enqueueMotion(17, {2, 2, 200});
    queue.enqueueMotion(22, {5, 5, 500});
    assert(queue.size() == 2);
    const auto first = queue.pop();
    const auto second = queue.pop();
    assert(first.outputId == 17);
    assert(first.motion.x == 2);
    assert(first.motion.y == 2);
    assert(first.motion.timeUsec == 200);
    assert(second.outputId == 22);
    return 0;
}
```

Run:

```sh
tools/vivid.sh hyprland-plugin test
```

Expected: fails because `SocketQueue` does not exist.

- [ ] **Step 4: Implement bounded latest-motion queue**

Create `consumer/hyprland-plugin/src/vivid_socket.hpp` with a pure queue type:

```cpp
#pragma once

#include <cstddef>
#include <cstdint>
#include <deque>

namespace vivid::hyprland {

struct PointerMotion {
    double x = 0.0;
    double y = 0.0;
    uint64_t timeUsec = 0;
};

struct QueuedMotion {
    uint32_t outputId = 0;
    PointerMotion motion;
};

class SocketQueue {
  public:
    explicit SocketQueue(size_t capacity = 64);
    void enqueueMotion(uint32_t outputId, PointerMotion motion);
    [[nodiscard]] bool empty() const;
    [[nodiscard]] size_t size() const;
    QueuedMotion pop();

  private:
    size_t m_capacity = 64;
    std::deque<QueuedMotion> m_items;
};

}
```

Create `consumer/hyprland-plugin/src/vivid_socket.cpp`:

```cpp
#include "vivid_socket.hpp"

#include <stdexcept>

namespace vivid::hyprland {

SocketQueue::SocketQueue(size_t capacity) : m_capacity(capacity == 0 ? 1 : capacity) {}

void SocketQueue::enqueueMotion(uint32_t outputId, PointerMotion motion) {
    for (auto it = m_items.rbegin(); it != m_items.rend(); ++it) {
        if (it->outputId == outputId) {
            it->motion = motion;
            return;
        }
    }

    if (m_items.size() >= m_capacity)
        m_items.pop_front();

    m_items.push_back({outputId, motion});
}

bool SocketQueue::empty() const {
    return m_items.empty();
}

size_t SocketQueue::size() const {
    return m_items.size();
}

QueuedMotion SocketQueue::pop() {
    if (m_items.empty())
        throw std::out_of_range("SocketQueue::pop on empty queue");
    auto item = m_items.front();
    m_items.pop_front();
    return item;
}

}
```

Wire `src/vivid_socket.cpp` into the test executable. Do not connect to a real socket in this task.

- [ ] **Step 5: Verify and commit**

Run:

```sh
tools/vivid.sh hyprland-plugin test
```

Expected: protocol and queue tests pass.

Commit:

```sh
git add consumer/hyprland-plugin
git commit -m "feat: add Hyprland bridge protocol queue"
```

## Task 3: Output Mapping And Coordinate Conversion

**Files:**
- Create: `consumer/hyprland-plugin/src/output_map.hpp`
- Create: `consumer/hyprland-plugin/src/output_map.cpp`
- Create: `consumer/hyprland-plugin/src/pointer_mapper.hpp`
- Create: `consumer/hyprland-plugin/src/pointer_mapper.cpp`
- Create: `consumer/hyprland-plugin/tests/output_map_test.cpp`
- Create: `consumer/hyprland-plugin/tests/pointer_mapper_test.cpp`
- Modify: `consumer/hyprland-plugin/meson.build`

- [ ] **Step 1: Write failing pointer mapper test**

Create `consumer/hyprland-plugin/tests/pointer_mapper_test.cpp`:

```cpp
#include "../src/pointer_mapper.hpp"

#include <cassert>
#include <cmath>

int main() {
    vivid::hyprland::MonitorGeometry monitor{
        .name = "HDMI-A-1",
        .x = 1920,
        .y = 0,
        .logicalWidth = 1280,
        .logicalHeight = 720,
        .scale = 1.5,
    };

    const auto mapped = vivid::hyprland::mapPointerToMonitor(monitor, 2020, 100);
    assert(mapped.has_value());
    assert(mapped->monitorName == "HDMI-A-1");
    assert(std::fabs(mapped->x - 150.0) < 0.00001);
    assert(std::fabs(mapped->y - 150.0) < 0.00001);

    const auto outside = vivid::hyprland::mapPointerToMonitor(monitor, 100, 100);
    assert(!outside.has_value());
    return 0;
}
```

Run:

```sh
tools/vivid.sh hyprland-plugin test
```

Expected: fails because `pointer_mapper.hpp` does not exist.

- [ ] **Step 2: Implement pure pointer mapping**

Create `consumer/hyprland-plugin/src/pointer_mapper.hpp`:

```cpp
#pragma once

#include <optional>
#include <string>

namespace vivid::hyprland {

struct MonitorGeometry {
    std::string name;
    double x = 0.0;
    double y = 0.0;
    double logicalWidth = 0.0;
    double logicalHeight = 0.0;
    double scale = 1.0;
};

struct MappedPointer {
    std::string monitorName;
    double x = 0.0;
    double y = 0.0;
};

std::optional<MappedPointer> mapPointerToMonitor(const MonitorGeometry& monitor, double globalX, double globalY);

}
```

Create `consumer/hyprland-plugin/src/pointer_mapper.cpp`:

```cpp
#include "pointer_mapper.hpp"

namespace vivid::hyprland {

std::optional<MappedPointer> mapPointerToMonitor(const MonitorGeometry& monitor, double globalX, double globalY) {
    if (monitor.logicalWidth <= 0.0 || monitor.logicalHeight <= 0.0)
        return std::nullopt;

    if (globalX < monitor.x || globalY < monitor.y ||
        globalX >= monitor.x + monitor.logicalWidth ||
        globalY >= monitor.y + monitor.logicalHeight)
        return std::nullopt;

    const double scale = monitor.scale > 0.0 ? monitor.scale : 1.0;
    return MappedPointer{
        .monitorName = monitor.name,
        .x = (globalX - monitor.x) * scale,
        .y = (globalY - monitor.y) * scale,
    };
}

}
```

- [ ] **Step 3: Write failing output map test**

Create `consumer/hyprland-plugin/tests/output_map_test.cpp`:

```cpp
#include "../src/output_map.hpp"

#include <cassert>
#include <string>

int main() {
    vivid::hyprland::OutputMap map;
    map.setMonitorOutputId("DP-1", 17);
    map.setMonitorOutputId("HDMI-A-1", 22);
    assert(map.outputIdForMonitor("DP-1").value() == 17);
    assert(map.outputIdForMonitor("HDMI-A-1").value() == 22);
    assert(!map.outputIdForMonitor("missing").has_value());
    return 0;
}
```

Run:

```sh
tools/vivid.sh hyprland-plugin test
```

Expected: fails because `output_map.hpp` does not exist.

- [ ] **Step 4: Implement monitor-name output map**

Create `consumer/hyprland-plugin/src/output_map.hpp`:

```cpp
#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <unordered_map>

namespace vivid::hyprland {

class OutputMap {
  public:
    void setMonitorOutputId(const std::string& monitorName, uint32_t outputId);
    [[nodiscard]] std::optional<uint32_t> outputIdForMonitor(const std::string& monitorName) const;
    void clear();

  private:
    std::unordered_map<std::string, uint32_t> m_byMonitorName;
};

}
```

Create `consumer/hyprland-plugin/src/output_map.cpp`:

```cpp
#include "output_map.hpp"

namespace vivid::hyprland {

void OutputMap::setMonitorOutputId(const std::string& monitorName, uint32_t outputId) {
    if (monitorName.empty() || outputId == 0)
        return;
    m_byMonitorName[monitorName] = outputId;
}

std::optional<uint32_t> OutputMap::outputIdForMonitor(const std::string& monitorName) const {
    const auto it = m_byMonitorName.find(monitorName);
    if (it == m_byMonitorName.end())
        return std::nullopt;
    return it->second;
}

void OutputMap::clear() {
    m_byMonitorName.clear();
}

}
```

- [ ] **Step 5: Verify and commit**

Run:

```sh
tools/vivid.sh hyprland-plugin test
```

Expected: protocol, queue, output map, and pointer mapper tests pass.

Commit:

```sh
git add consumer/hyprland-plugin
git commit -m "feat: map Hyprland pointer coordinates"
```

## Task 4: Runtime Plugin Bridge For Pointer Motion

**Files:**
- Create: `consumer/hyprland-plugin/src/vivid_bridge.hpp`
- Modify: `consumer/hyprland-plugin/src/plugin.cpp`
- Modify: `consumer/hyprland-plugin/src/vivid_socket.hpp`
- Modify: `consumer/hyprland-plugin/src/vivid_socket.cpp`
- Modify: `consumer/hyprland-plugin/meson.build`

- [ ] **Step 1: Extend socket client without Hyprland dependency**

Add a `VividSocketClient` class to `vivid_socket.hpp/.cpp` with:

```cpp
class VividSocketClient {
  public:
    explicit VividSocketClient(std::string socketPath);
    ~VividSocketClient();

    void setSocketPath(std::string socketPath);
    void enqueueMotion(uint32_t outputId, PointerMotion motion);
    void flush();
    void close();

  private:
    std::string m_socketPath;
    int m_fd = -1;
    SocketQueue m_queue;
};
```

Implementation requirements:

- Use `socket(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0)`.
- Use `connect`; if it fails with `ENOENT`, `ECONNREFUSED`, or `EINPROGRESS`, keep the event path non-fatal and retry on later `flush()`.
- Use `encodePointerMotion()` and `send(..., MSG_DONTWAIT | MSG_NOSIGNAL)`.
- Never block in Hyprland event callbacks.
- On hard socket errors, close fd and keep queued latest motion.

- [ ] **Step 2: Add bridge state**

Create `consumer/hyprland-plugin/src/vivid_bridge.hpp`:

```cpp
#pragma once

#include "output_map.hpp"
#include "vivid_socket.hpp"

#include <string>

namespace vivid::hyprland {

struct BridgeConfig {
    bool enabled = true;
    bool pointerMotion = true;
    bool pointerButton = false;
    bool pointerAxis = false;
    std::string socketPath;
    std::string requiredHash;
};

struct BridgeState {
    BridgeConfig config;
    OutputMap outputs;
    VividSocketClient socket;

    explicit BridgeState(BridgeConfig initial)
        : config(std::move(initial)), socket(config.socketPath) {}
};

}
```

- [ ] **Step 3: Register Hyprland config values**

In `plugin.cpp`, add config values in `PLUGIN_INIT` using `HyprlandAPI::addConfigValueV2` and the installed value classes:

- `plugin:vivid:enabled`, default `true`
- `plugin:vivid:socket`, default `$XDG_RUNTIME_DIR/vivid/display-v1.sock` when `VIVID_HYPRLAND_DEFAULT_SOCKET` is empty
- `plugin:vivid:pointer_motion`, default `true`
- `plugin:vivid:pointer_button`, default `false`
- `plugin:vivid:pointer_axis`, default `false`
- `plugin:vivid:required_hash`, default compiled `__hyprland_api_get_client_hash()`
- `plugin:vivid:log_level`, default `info`

If the installed Hyprland value class constructors differ, inspect:

```sh
sed -n '1,120p' /usr/include/hyprland/src/config/values/types/BoolValue.hpp
sed -n '1,120p' /usr/include/hyprland/src/config/values/types/StringValue.hpp
```

Then adapt to the actual 0.55.3 constructor signatures. Do not use deprecated `addConfigValue` unless V2 cannot compile locally.

- [ ] **Step 4: Validate hash before registering listeners**

In `PLUGIN_INIT`, call:

```cpp
const auto running = HyprlandAPI::getHyprlandVersion(handle);
```

If configured or compiled required hash is non-empty and does not match `running.hash` or `__hyprland_api_get_client_hash()`, return plugin info but do not subscribe to input events.

Expected behavior:

- Wrong hash fails closed.
- Plugin still loads enough for `hyprctl plugins list` to show it.
- No pointer events are forwarded when hash validation fails.

- [ ] **Step 5: Subscribe to motion event only**

Use:

```cpp
Event::bus()->m_events.input.mouse.move.registerStaticListener(...)
```

or the correct listener API from `helpers/signal/Signal.hpp` if `registerStaticListener` differs. The listener must:

- leave `SCallbackInfo.cancelled` unchanged;
- read current cursor position through `g_pPointerManager->position()` or use the event-provided `Vector2D` if Hyprland 0.55.3 emits global logical coordinates;
- find monitor with `g_pCompositor->getMonitorFromVector(position)`;
- build `MonitorGeometry` from `PHLMONITOR->m_name`, `m_position`, `m_size`, and `m_scale`;
- call `mapPointerToMonitor`;
- resolve backend output id by monitor name;
- enqueue and flush motion through `VividSocketClient`.

If `Event::bus()->m_events.input.mouse.move` does not expose the final absolute position, prefer `g_pPointerManager->position()` after the event has been applied. Do not poll Hyprland IPC.

- [ ] **Step 6: Verify build and compositor-safe shape**

Run:

```sh
tools/vivid.sh hyprland-plugin build
tools/vivid.sh hyprland-plugin test
```

Expected:

- Plugin builds.
- Unit tests pass.
- No function hooks are introduced.

Commit:

```sh
git add consumer/hyprland-plugin
git commit -m "feat: forward Hyprland pointer motion"
```

## Task 5: Wayland Consumer Polling Path Retirement

**Files:**
- Modify: `consumer/wayland/src/runtimeArgs.js`
- Modify: `consumer/wayland/src/layer-shell-probe.js`
- Modify: `consumer/wayland/src/protocolPayloads.js`
- Modify: `consumer/wayland/meson.build`
- Modify: `consumer/wayland/tests/runtime-args.test.js`
- Modify: `consumer/wayland/tests/protocol-payloads.test.js`
- Modify/Delete: `consumer/wayland/tests/hyprland-pointer.test.js`
- Modify/Delete: `consumer/wayland/src/hyprlandPointer.js`

- [ ] **Step 1: Write failing runtime tests**

Update `runtime-args.test.js` so `--enable-pointer-events --compositor hyprland` sets a new field:

```js
assertEqual(options.pointerEventsRequested, true, 'pointer events requested');
assertEqual(options.pointerEventsEnabled, false, 'Wayland consumer does not enable internal pointer forwarding');
assertEqual(options.requiresHyprlandPlugin, true, 'Hyprland plugin is required');
```

For non-Hyprland compositors:

```js
assertEqual(options.pointerEventsRequested, true, 'pointer events request is preserved');
assertEqual(options.pointerEventsEnabled, false, 'pointer forwarding remains disabled');
assertEqual(options.requiresHyprlandPlugin, false, 'non-Hyprland does not require plugin');
```

Run:

```sh
meson test -C consumer/wayland/.build runtime-args
```

Expected: fails against current parser behavior.

- [ ] **Step 2: Implement parser behavior**

Change `parseRuntimeArgs` so:

- `pointerEventsRequested` records user intent.
- `pointerEventsEnabled` is always `false` in the Wayland consumer.
- `requiresHyprlandPlugin` is `true` only when pointer events were requested, input was not disabled, and compositor resolves to `hyprland`.

Do not advertise `pointer-events-v1` from the Wayland consumer after this change.

- [ ] **Step 3: Update protocol payload tests**

Update `protocol-payloads.test.js` so both enabled/requested and disabled payloads omit `pointer-events-v1` and report `pointerEvents: false`.

Run:

```sh
meson test -C consumer/wayland/.build protocol-payloads
```

Expected: protocol payload tests pass with pointer advertisement removed from the Wayland consumer.

- [ ] **Step 4: Remove runtime polling provider**

In `layer-shell-probe.js`, remove:

```js
pointerProvider = options.pointerEventsEnabled && options.compositor === 'hyprland'
    ? new HyprlandPointer.HyprlandPointerProvider(...)
    : null;
pointerProvider?.start();
```

Replace it with one startup warning:

```js
if (options.requiresHyprlandPlugin) {
    printerr('Vivid Wayland Consumer: --enable-pointer-events requires the vivid Hyprland plugin; internal Hyprland polling is disabled.');
}
```

Remove `HyprlandPointer` import if it becomes unused. Delete `consumer/wayland/src/hyprlandPointer.js` and its Meson test only if no other code imports it.

- [ ] **Step 5: Verify and commit**

Run:

```sh
tools/vivid.sh wayland build
meson test -C consumer/wayland/.build
```

Expected:

- All Wayland consumer tests pass.
- No code path runs `hyprctl cursorpos` or opens Hyprland IPC for cursor polling.

Commit:

```sh
git add consumer/wayland
git commit -m "fix: require Hyprland plugin for pointer forwarding"
```

## Task 6: Documentation And Manual Install Notes

**Files:**
- Modify: `README.md`
- Modify: `consumer/wayland/README.md`
- Create: `consumer/hyprland-plugin/README.md`

- [ ] **Step 1: Add plugin README**

Create `consumer/hyprland-plugin/README.md` with:

```markdown
# Vivid Hyprland Bridge

`libvivid-hyprland-bridge.so` is a Hyprland-only plugin for passive Wallpaper Engine pointer forwarding.

It does not render wallpaper frames and it does not make the wallpaper layer accept input. The normal Wayland consumer still owns layer-shell wallpaper display.

## Build

```sh
tools/vivid.sh hyprland-plugin build
tools/vivid.sh hyprland-plugin test
```

## Install

```sh
tools/vivid.sh hyprland-plugin install
```

Load the installed shared object with Hyprland's plugin loader for the same Hyprland build it was compiled against. ABI compatibility is not guaranteed across Hyprland versions.

## Config

```ini
plugin:vivid:enabled = true
plugin:vivid:socket = $XDG_RUNTIME_DIR/vivid/display-v1.sock
plugin:vivid:pointer_motion = true
plugin:vivid:pointer_button = false
plugin:vivid:pointer_axis = false
```

Button and axis forwarding are reserved for a later milestone and remain disabled by default.
```

- [ ] **Step 2: Update Wayland README**

Add a short section:

```markdown
## Hyprland Pointer Events

The Wayland consumer keeps wallpaper layer-shell surfaces input-transparent. On Hyprland, pointer forwarding is provided by `consumer/hyprland-plugin/`, not by polling `hyprctl` or Hyprland IPC from the consumer process.

`--enable-pointer-events` is accepted as a compatibility hint. It prints a plugin-required message and does not enable internal polling.
```

- [ ] **Step 3: Update root README**

Add an experimental Hyprland plugin build command near the Wayland consumer instructions:

```markdown
tools/vivid.sh hyprland-plugin build
tools/vivid.sh hyprland-plugin test
```

Mention that the plugin must be rebuilt after Hyprland upgrades.

- [ ] **Step 4: Verify docs references**

Run:

```sh
rg -n "hyprctl cursorpos|HyprlandPointerProvider|enable-pointer-events|hyprland-plugin" README.md consumer/wayland consumer/hyprland-plugin docs/superpowers
```

Expected:

- `hyprctl cursorpos` appears only in historical docs/spec context or not at all.
- `HyprlandPointerProvider` is not referenced by active runtime code.
- `hyprland-plugin` commands are documented.

Commit:

```sh
git add README.md consumer/wayland/README.md consumer/hyprland-plugin/README.md
git commit -m "docs: document Hyprland bridge plugin"
```

## Task 7: Manual Runtime Verification

**Files:**
- No required code files.
- Optional: add notes to `consumer/hyprland-plugin/README.md` if manual verification finds missing instructions.

- [ ] **Step 1: Build everything relevant**

Run:

```sh
tools/vivid.sh hyprland-plugin build
tools/vivid.sh hyprland-plugin test
tools/vivid.sh wayland build
meson test -C consumer/wayland/.build
```

Expected: all pass in the local development environment.

- [ ] **Step 2: Inspect plugin symbols**

Run:

```sh
nm -D consumer/hyprland-plugin/.build/libvivid-hyprland-bridge.so | rg 'pluginAPIVersion|pluginInit|pluginExit|__hyprland_api_get_client_hash'
```

Expected: required plugin symbols are exported.

- [ ] **Step 3: Load plugin in Hyprland**

In a Hyprland session matching the installed headers, load the plugin with the user's normal Hyprland plugin mechanism. Then run:

```sh
hyprctl plugins list
```

Expected:

- `vivid-hyprland-bridge` appears.
- Hyprland does not crash or freeze.
- Logs do not show ABI mismatch unless the running Hyprland hash differs from the compiled headers.

- [ ] **Step 4: Verify passive pointer behavior**

Run the producer and Wayland consumer normally. Move the pointer over each monitor.

Expected:

- Wallpaper remains visible.
- Desktop clicks still reach normal windows.
- No fd pressure or repeated DMA-BUF import failures appear.
- Pointer-reactive wallpaper content receives motion if the producer has accepted output ids.

- [ ] **Step 5: Final commit or follow-up**

If runtime verification required documentation edits:

```sh
git add consumer/hyprland-plugin/README.md README.md
git commit -m "docs: clarify Hyprland plugin runtime verification"
```

If no edits were needed, record the verification commands and results in the controller final response.

## Self-Review

Spec coverage:

- Hyprland plugin path and shared object name are covered in Tasks 1 and 6.
- Hash validation, config keys, and `Event::bus()` preference are covered in Task 4.
- Pointer motion coordinate conversion and output identity are covered in Tasks 3 and 4.
- Socket failure handling and latest-motion coalescing are covered in Task 2 and Task 4.
- Button and axis are intentionally not implemented in Phase A; config defaults reserve them for later without forwarding.
- Wayland consumer polling retirement is covered in Task 5.
- Desktop facts helper is explicitly out of scope for this plugin plan.

No placeholders are intentionally left. The one API uncertainty is handled as a compile-probe and header-inspection step in Task 1 and Task 4 because Hyprland plugin ABI details must be verified against installed headers.
