#include "../src/output_map.hpp"

#include <cassert>
#include <filesystem>
#include <fstream>
#include <string>

int main() {
    vivid::hyprland::OutputMap map;
    map.setMonitorOutputId("DP-1", 17);
    map.setMonitorOutputId("HDMI-A-1", 22);
    assert(map.outputIdForMonitor("DP-1").value() == 17);
    assert(map.outputIdForMonitor("HDMI-A-1").value() == 22);
    assert(!map.outputIdForMonitor("missing").has_value());

    const auto tempPath = std::filesystem::temp_directory_path() / "vivid-output-map-test.json";
    {
        std::ofstream file(tempPath);
        file << R"({"version":1,"outputs":[{"monitorName":"DP-1","outputId":17},{"monitorName":"HDMI-A-1","outputId":22},{"monitorName":"","outputId":33},{"monitorName":"ignored","outputId":0}]})";
    }

    vivid::hyprland::OutputMap loaded;
    assert(loaded.loadFromFile(tempPath.string()));
    assert(loaded.outputIdForMonitor("DP-1").value() == 17);
    assert(loaded.outputIdForMonitor("HDMI-A-1").value() == 22);
    assert(!loaded.outputIdForMonitor("ignored").has_value());

    {
        std::ofstream file(tempPath);
        file << R"({"version":1,"outputs":[{"monitorName":"DP-1","outputId":"bad"}]})";
    }
    assert(!loaded.loadFromFile(tempPath.string()));
    assert(!loaded.outputIdForMonitor("DP-1").has_value());
    assert(!loaded.outputIdForMonitor("HDMI-A-1").has_value());

    loaded.setMonitorOutputId("DP-1", 17);
    loaded.setMonitorOutputId("HDMI-A-1", 22);
    std::filesystem::remove(tempPath);
    assert(!loaded.loadFromFile(tempPath.string()));
    assert(!loaded.outputIdForMonitor("DP-1").has_value());
    assert(!loaded.outputIdForMonitor("HDMI-A-1").has_value());

    return 0;
}
