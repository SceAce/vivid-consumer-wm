#pragma once

#include "output_map.hpp"
#include "vivid_socket.hpp"

#include <src/helpers/signal/Signal.hpp>

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

namespace vivid::hyprland {

struct BridgeConfig {
    bool enabled = true;
    bool pointerMotion = true;
    bool pointerButton = false;
    bool pointerAxis = false;
    std::string socketPath;
    std::string outputMapPath;
    std::string requiredHash;
};

// Hash policy: returns true if hash validation passes or no hash is required.
// configuredRequired comes from runtime config (plugin:vivid:required_hash),
// compiledRequired from the compile-time VIVID_HYPRLAND_REQUIRED_HASH macro.
// runningHash is the compositor's server ABI hash from __hyprland_api_get_hash().
// If Hyprland does not expose a runtime hash, do not block registration solely on
// the missing runtime value.
inline bool checkHashPolicy(const std::string& configuredRequired,
                             const std::string& compiledRequired,
                             const std::string& runningHash) {
    if (runningHash.empty())
        return configuredRequired.empty() && compiledRequired.empty();
    if (!configuredRequired.empty())
        return configuredRequired == runningHash;
    if (!compiledRequired.empty())
        return compiledRequired == runningHash;
    return true;
}

struct BridgeState {
    BridgeConfig config;
    OutputMap outputs;
    VividSocketClient socket;
    std::vector<CHyprSignalListener> listeners;
    std::chrono::steady_clock::time_point lastOutputMapReload{};
    std::atomic<bool> outputMapReloadRequested{false};
    std::atomic<bool> outputMapWorkerStop{false};
    std::mutex outputMapWorkerMutex;
    std::condition_variable outputMapWorkerCv;
    std::thread outputMapWorker;

    explicit BridgeState(BridgeConfig initial)
        : config(std::move(initial)), socket(config.socketPath) {}

    ~BridgeState() {
        outputMapWorkerStop.store(true);
        outputMapWorkerCv.notify_all();
        if (outputMapWorker.joinable())
            outputMapWorker.join();
    }
};

} // namespace vivid::hyprland
