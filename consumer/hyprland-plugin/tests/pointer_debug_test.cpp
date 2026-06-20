#include "../src/pointer_debug.hpp"

#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <string>

namespace {

int expect(bool condition, const char* message) {
    if (condition)
        return 0;

    std::cerr << "FAIL: " << message << '\n';
    return 1;
}

} // namespace

int main() {
    vivid::hyprland::resetPointerDebugStateForTests();
    unsetenv("VIVID_POINTER_DEBUG");
    if (expect(!vivid::hyprland::pointerDebugEnabled(),
               "debug should be disabled when VIVID_POINTER_DEBUG is unset") != 0)
        return 1;

    vivid::hyprland::setPointerDebugLogLevel("info");
    if (expect(!vivid::hyprland::pointerDebugEnabled(),
               "debug should stay disabled when log level is info") != 0)
        return 1;

    vivid::hyprland::setPointerDebugLogLevel("debug");
    if (expect(vivid::hyprland::pointerDebugEnabled(),
               "debug should be enabled when log level is debug") != 0)
        return 1;

    vivid::hyprland::setPointerDebugLogLevel("INFO");
    if (expect(!vivid::hyprland::pointerDebugEnabled(),
               "debug should be disabled when log level leaves debug") != 0)
        return 1;

    setenv("VIVID_POINTER_DEBUG", "0", 1);
    if (expect(!vivid::hyprland::pointerDebugEnabled(),
               "debug should be disabled when VIVID_POINTER_DEBUG=0") != 0)
        return 1;

    vivid::hyprland::setPointerDebugLogLevel("debug");
    if (expect(vivid::hyprland::pointerDebugEnabled(),
               "config debug should remain enabled when VIVID_POINTER_DEBUG=0") != 0)
        return 1;

    vivid::hyprland::setPointerDebugLogLevel("info");
    setenv("VIVID_POINTER_DEBUG", "1", 1);
    if (expect(vivid::hyprland::pointerDebugEnabled(),
               "debug should be enabled when VIVID_POINTER_DEBUG=1") != 0)
        return 1;

    unsetenv("VIVID_POINTER_DEBUG");
    vivid::hyprland::resetPointerDebugStateForTests();

    const std::string line = vivid::hyprland::formatPointerDebugLine(
        "mouse.move",
        {{"monitor", "DP-1"}, {"outputId", "17"}}
    );
    if (expect(line.find("mouse.move") != std::string::npos,
               "formatted line should include event name") != 0)
        return 1;
    if (expect(line.find("monitor=DP-1") != std::string::npos,
               "formatted line should include monitor field") != 0)
        return 1;
    if (expect(line.find("outputId=17") != std::string::npos,
               "formatted line should include outputId field") != 0)
        return 1;

    const auto tempRoot = std::filesystem::temp_directory_path() / "vivid-pointer-debug-test";
    const auto logPath = tempRoot / "nested" / "pointer.log";
    std::filesystem::remove_all(tempRoot);

    vivid::hyprland::setPointerDebugLogLevel("debug");
    vivid::hyprland::setPointerDebugLogFile(logPath.string());
    vivid::hyprland::pointerDebugLog("file.write", {{"key", "value"}});

    if (expect(std::filesystem::exists(logPath),
               "debug log file should be created when file logging is configured") != 0)
        return 1;

    std::ifstream logFile(logPath);
    std::string logContents;
    std::getline(logFile, logContents);
    if (expect(logContents.find("event=file.write") != std::string::npos,
               "debug log file should include event name") != 0)
        return 1;
    if (expect(logContents.find("key=value") != std::string::npos,
               "debug log file should include fields") != 0)
        return 1;

    return 0;
}
