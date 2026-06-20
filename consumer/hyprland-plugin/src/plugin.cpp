#include <src/plugins/PluginAPI.hpp>
#include <src/event/EventBus.hpp>
#include <src/config/values/types/BoolValue.hpp>
#include <src/config/values/types/StringValue.hpp>
#include <src/managers/PointerManager.hpp>
#include <src/Compositor.hpp>
#include <src/helpers/Monitor.hpp>
#include <src/helpers/signal/Signal.hpp>

#include "vivid_bridge.hpp"
#include "output_map.hpp"
#include "pointer_debug.hpp"
#include "pointer_mapper.hpp"

#include <any>
#include <chrono>
#include <cstdlib>
#include <memory>
#include <string>
#include <thread>
#include <vector>

namespace {
    HANDLE g_pluginHandle = nullptr;
    std::unique_ptr<vivid::hyprland::BridgeState> g_bridgeState;
}

APICALL EXPORT std::string PLUGIN_API_VERSION() {
    return HYPRLAND_API_VERSION;
}

namespace {

std::string defaultRuntimeFilePath(const char* leafName) {
    const char* runtimeDir = getenv("XDG_RUNTIME_DIR");
    if (!runtimeDir)
        return {};
    return std::string(runtimeDir) + "/vivid/" + leafName;
}

void requestOutputMapReloadIfDue() {
    if (!g_bridgeState || g_bridgeState->config.outputMapPath.empty())
        return;

    const auto now = std::chrono::steady_clock::now();
    if (g_bridgeState->lastOutputMapReload.time_since_epoch().count() != 0 &&
        now - g_bridgeState->lastOutputMapReload < std::chrono::milliseconds(250)) {
        return;
    }

    g_bridgeState->lastOutputMapReload = now;
    g_bridgeState->outputMapReloadRequested.store(true);
    g_bridgeState->outputMapWorkerCv.notify_one();
}

void runOutputMapWorker(vivid::hyprland::BridgeState* state) {
    while (!state->outputMapWorkerStop.load()) {
        std::unique_lock lock(state->outputMapWorkerMutex);
        state->outputMapWorkerCv.wait(lock, [&] {
            return state->outputMapWorkerStop.load() ||
                state->outputMapReloadRequested.load();
        });
        lock.unlock();

        if (state->outputMapWorkerStop.load())
            break;
        state->outputMapReloadRequested.store(false);
        if (!state->config.outputMapPath.empty())
            (void)state->outputs.loadFromFile(state->config.outputMapPath);
    }
}

void handleMouseMove(const Vector2D& pos) {
    if (!g_bridgeState || !g_bridgeState->config.enabled || !g_bridgeState->config.pointerMotion)
        return;

    PHLMONITOR pMonitor = g_pCompositor->getMonitorFromVector(pos);
    if (!pMonitor || pMonitor->m_name.empty())
        return;

    const vivid::hyprland::MonitorGeometry monitor{
        .name          = pMonitor->m_name,
        .x             = pMonitor->m_position.x,
        .y             = pMonitor->m_position.y,
        .logicalWidth  = pMonitor->m_size.x,
        .logicalHeight = pMonitor->m_size.y,
        .scale         = static_cast<double>(pMonitor->m_scale),
    };

    const auto mapped = vivid::hyprland::mapPointerToMonitor(monitor, pos.x, pos.y);
    if (!mapped.has_value())
        return;

    if (vivid::hyprland::pointerDebugEnabled()) {
        vivid::hyprland::pointerDebugLog("mouse.move.enter", {
            {"monitor", mapped->monitorName},
            {"globalX", std::to_string(pos.x)},
            {"globalY", std::to_string(pos.y)},
            {"localX", std::to_string(mapped->x)},
            {"localY", std::to_string(mapped->y)},
        });
    }

    requestOutputMapReloadIfDue();
    const auto outputId = g_bridgeState->outputs.outputIdForMonitor(mapped->monitorName);
    if (!outputId.has_value())
        return;

    if (vivid::hyprland::pointerDebugEnabled()) {
        vivid::hyprland::pointerDebugLog("mouse.move.route", {
            {"monitor", mapped->monitorName},
            {"outputId", std::to_string(outputId.value())},
            {"enqueue", "1"},
            {"flush", "1"},
        });
    }

    const auto now = std::chrono::duration_cast<std::chrono::microseconds>(
        std::chrono::steady_clock::now().time_since_epoch()
    ).count();

    g_bridgeState->socket.enqueueMotion(outputId.value(), {
        .x        = mapped->x,
        .y        = mapped->y,
        .timeUsec = static_cast<uint64_t>(now),
    });
    g_bridgeState->socket.flush();
}

bool readConfigBool(HANDLE handle, const std::string& key, bool defaultValue) {
    #pragma GCC diagnostic push
    #pragma GCC diagnostic ignored "-Wdeprecated-declarations"
    auto* val = HyprlandAPI::getConfigValue(handle, key);
    #pragma GCC diagnostic pop
    if (!val)
        return defaultValue;
    return std::any_cast<Hyprlang::INT>(val->getValue()) != 0;
}

std::string readConfigString(HANDLE handle, const std::string& key, const std::string& defaultValue) {
    #pragma GCC diagnostic push
    #pragma GCC diagnostic ignored "-Wdeprecated-declarations"
    auto* val = HyprlandAPI::getConfigValue(handle, key);
    #pragma GCC diagnostic pop
    if (!val)
        return defaultValue;
    auto s = std::any_cast<Hyprlang::STRING>(val->getValue());
    return s ? std::string(s) : defaultValue;
}

std::string readRuntimeServerHash() {
    const char* runtimeHash = __hyprland_api_get_hash();
    return runtimeHash ? std::string(runtimeHash) : std::string{};
}

} // anonymous namespace

APICALL EXPORT PLUGIN_DESCRIPTION_INFO PLUGIN_INIT(HANDLE handle) {
    g_pluginHandle = handle;
    vivid::hyprland::setPointerDebugLogFile(defaultRuntimeFilePath("hyprland-plugin.log"));

    // Compute effective compiled hash: use build-time macro if set,
    // otherwise fall back to the Hyprland inline API client hash
    std::string effectiveCompiledHash = VIVID_HYPRLAND_REQUIRED_HASH;
    if (effectiveCompiledHash.empty()) {
        const char* clientHash = __hyprland_api_get_client_hash();
        if (clientHash)
            effectiveCompiledHash = clientHash;
    }

    // Register config values
    HyprlandAPI::addConfigValueV2(handle, makeShared<Config::Values::CBoolValue>(
        "plugin:vivid:enabled", "Enable Vivid bridge pointer forwarding", true
    ));
    HyprlandAPI::addConfigValueV2(handle, makeShared<Config::Values::CBoolValue>(
        "plugin:vivid:pointer_motion", "Forward pointer motion events", true
    ));
    HyprlandAPI::addConfigValueV2(handle, makeShared<Config::Values::CBoolValue>(
        "plugin:vivid:pointer_button", "Forward pointer button events (reserved)", false
    ));
    HyprlandAPI::addConfigValueV2(handle, makeShared<Config::Values::CBoolValue>(
        "plugin:vivid:pointer_axis", "Forward pointer axis events (reserved)", false
    ));
    HyprlandAPI::addConfigValueV2(handle, makeShared<Config::Values::CStringValue>(
        "plugin:vivid:socket", "Vivid display-v1 socket path", Config::STRING{}
    ));
    HyprlandAPI::addConfigValueV2(handle, makeShared<Config::Values::CStringValue>(
        "plugin:vivid:output_map", "Vivid output mapping JSON path", Config::STRING{}
    ));
    HyprlandAPI::addConfigValueV2(handle, makeShared<Config::Values::CStringValue>(
        "plugin:vivid:required_hash", "Required Hyprland ABI hash for event forwarding",
        effectiveCompiledHash.c_str()
    ));
    HyprlandAPI::addConfigValueV2(handle, makeShared<Config::Values::CStringValue>(
        "plugin:vivid:log_level", "Log level (info, debug, warn, error)", "info"
    ));

    // Read config
    vivid::hyprland::BridgeConfig cfg;
    cfg.enabled       = readConfigBool(handle, "plugin:vivid:enabled", true);
    cfg.pointerMotion = readConfigBool(handle, "plugin:vivid:pointer_motion", true);
    cfg.pointerButton = readConfigBool(handle, "plugin:vivid:pointer_button", false);
    cfg.pointerAxis   = readConfigBool(handle, "plugin:vivid:pointer_axis", false);
    cfg.socketPath    = readConfigString(handle, "plugin:vivid:socket", "");
    cfg.outputMapPath = readConfigString(handle, "plugin:vivid:output_map", "");
    cfg.requiredHash  = readConfigString(handle, "plugin:vivid:required_hash",
                                         effectiveCompiledHash.c_str());
    const auto logLevel = readConfigString(handle, "plugin:vivid:log_level", "info");
    vivid::hyprland::setPointerDebugLogLevel(logLevel);

    // Resolve socket path from config → compile-time default → XDG_RUNTIME_DIR
    if (cfg.socketPath.empty()) {
        cfg.socketPath = VIVID_HYPRLAND_DEFAULT_SOCKET;
    }
    if (cfg.socketPath.empty()) {
        cfg.socketPath = defaultRuntimeFilePath("display-v1.sock");
    }
    if (cfg.outputMapPath.empty())
        cfg.outputMapPath = defaultRuntimeFilePath("outputs.json");

    const auto runtimeHash = readRuntimeServerHash();
    const bool hashOk = vivid::hyprland::checkHashPolicy(
        cfg.requiredHash,
        effectiveCompiledHash,
        runtimeHash
    );
    if (!hashOk) {
        vivid::hyprland::pointerDebugLog("plugin.init", {
            {"enabled", cfg.enabled ? "1" : "0"},
            {"pointer_motion", cfg.pointerMotion ? "1" : "0"},
            {"socket", cfg.socketPath},
            {"output_map", cfg.outputMapPath},
            {"log_level", logLevel},
            {"required_hash", cfg.requiredHash},
            {"compiled_hash", effectiveCompiledHash},
            {"runtime_hash", runtimeHash},
            {"hash_ok", "0"},
            {"listener_registered", "0"},
        });
        g_pluginHandle = handle;
        return PLUGIN_DESCRIPTION_INFO{
            .name        = "vivid-hyprland-bridge",
            .description = "Passive Vivid display-v1 pointer bridge for Hyprland",
            .author      = "Vivid",
            .version     = "0.1.0",
        };
    }

    // Subscribe to pointer motion when enabled
    bool listenerRegistered = false;
    if (cfg.enabled) {
        g_bridgeState = std::make_unique<vivid::hyprland::BridgeState>(std::move(cfg));
        g_bridgeState->outputMapWorker = std::thread(runOutputMapWorker, g_bridgeState.get());
        g_bridgeState->outputMapReloadRequested.store(true);
        g_bridgeState->outputMapWorkerCv.notify_one();

        auto listener = Event::bus()->m_events.input.mouse.move.listen(
            [](Vector2D pos, Event::SCallbackInfo& info) {
                handleMouseMove(pos);
            }
        );
        g_bridgeState->listeners.push_back(std::move(listener));
        listenerRegistered = true;
    }

    const auto& activeCfg = g_bridgeState ? g_bridgeState->config : cfg;
    vivid::hyprland::pointerDebugLog("plugin.init", {
        {"enabled", activeCfg.enabled ? "1" : "0"},
        {"pointer_motion", activeCfg.pointerMotion ? "1" : "0"},
        {"socket", activeCfg.socketPath},
        {"output_map", activeCfg.outputMapPath},
        {"log_level", logLevel},
        {"required_hash", activeCfg.requiredHash},
        {"compiled_hash", effectiveCompiledHash},
        {"runtime_hash", runtimeHash},
        {"hash_ok", hashOk ? "1" : "0"},
        {"listener_registered", listenerRegistered ? "1" : "0"},
    });

    return PLUGIN_DESCRIPTION_INFO{
        .name        = "vivid-hyprland-bridge",
        .description = "Passive Vivid display-v1 pointer bridge for Hyprland",
        .author      = "Vivid",
        .version     = "0.1.0",
    };
}

APICALL EXPORT void PLUGIN_EXIT() {
    if (g_bridgeState)
        g_bridgeState->listeners.clear();
    g_bridgeState.reset();
    vivid::hyprland::setPointerDebugLogFile({});
    g_pluginHandle = nullptr;
}
