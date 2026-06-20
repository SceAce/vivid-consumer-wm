#pragma once

#include <initializer_list>
#include <string>
#include <string_view>
#include <utility>

namespace vivid::hyprland {

void setPointerDebugLogLevel(std::string_view logLevel);
void setPointerDebugLogFile(std::string path);
void resetPointerDebugStateForTests();
bool pointerDebugEnabled();
std::string formatPointerDebugLine(
    std::string_view event,
    std::initializer_list<std::pair<std::string_view, std::string_view>> fields
);
void pointerDebugLog(
    std::string_view event,
    std::initializer_list<std::pair<std::string_view, std::string_view>> fields
);

} // namespace vivid::hyprland
