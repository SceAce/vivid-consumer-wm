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
