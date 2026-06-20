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
