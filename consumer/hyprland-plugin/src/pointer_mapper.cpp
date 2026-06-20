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
