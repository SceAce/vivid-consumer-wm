#include "pointer_debug.hpp"

#include <atomic>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <mutex>
#include <sstream>
#include <string>

namespace vivid::hyprland {

namespace {

std::atomic<bool>& configuredPointerDebugEnabled() {
    static std::atomic<bool> enabled{false};
    return enabled;
}

std::mutex& pointerDebugLogPathMutex() {
    static std::mutex mutex;
    return mutex;
}

std::string& pointerDebugLogPath() {
    static std::string path;
    return path;
}

bool envPointerDebugEnabled() {
    const char* value = std::getenv("VIVID_POINTER_DEBUG");
    return value && std::string_view(value) == "1";
}

bool logLevelEnablesPointerDebug(std::string_view logLevel) {
    return logLevel == "debug" || logLevel == "DEBUG";
}

} // namespace

void setPointerDebugLogLevel(std::string_view logLevel) {
    configuredPointerDebugEnabled().store(
        logLevelEnablesPointerDebug(logLevel),
        std::memory_order_relaxed
    );
}

void setPointerDebugLogFile(std::string path) {
    std::lock_guard lock(pointerDebugLogPathMutex());
    pointerDebugLogPath() = std::move(path);
}

void resetPointerDebugStateForTests() {
    configuredPointerDebugEnabled().store(false, std::memory_order_relaxed);
    std::lock_guard lock(pointerDebugLogPathMutex());
    pointerDebugLogPath().clear();
}

bool pointerDebugEnabled() {
    return configuredPointerDebugEnabled().load(std::memory_order_relaxed) || envPointerDebugEnabled();
}

std::string formatPointerDebugLine(
    std::string_view event,
    std::initializer_list<std::pair<std::string_view, std::string_view>> fields
) {
    std::ostringstream line;
    line << "[vivid-pointer-debug] event=" << event;
    for (const auto& [key, value] : fields)
        line << ' ' << key << '=' << value;
    return line.str();
}

void pointerDebugLog(
    std::string_view event,
    std::initializer_list<std::pair<std::string_view, std::string_view>> fields
) {
    if (!pointerDebugEnabled())
        return;

    const auto line = formatPointerDebugLine(event, fields);
    bool wroteToFile = false;

    {
        std::lock_guard lock(pointerDebugLogPathMutex());
        const auto& path = pointerDebugLogPath();
        if (!path.empty()) {
            try {
                const std::filesystem::path fsPath(path);
                if (fsPath.has_parent_path())
                    std::filesystem::create_directories(fsPath.parent_path());

                std::ofstream file(fsPath, std::ios::app);
                if (file) {
                    file << line << '\n';
                    wroteToFile = true;
                }
            } catch (...) {
            }
        }
    }

    if (!wroteToFile)
        std::cerr << line << '\n';
}

} // namespace vivid::hyprland
