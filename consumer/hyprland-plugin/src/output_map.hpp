#pragma once

#include <cstdint>
#include <mutex>
#include <optional>
#include <string>
#include <unordered_map>

namespace vivid::hyprland {

class OutputMap {
  public:
    void setMonitorOutputId(const std::string& monitorName, uint32_t outputId);
    [[nodiscard]] std::optional<uint32_t> outputIdForMonitor(const std::string& monitorName) const;
    [[nodiscard]] bool loadFromFile(const std::string& path);
    [[nodiscard]] bool loadFromJson(const std::string& json);
    void clear();

  private:
    void replaceWith(std::unordered_map<std::string, uint32_t> next);

    std::unordered_map<std::string, uint32_t> m_byMonitorName;
    mutable std::mutex m_mutex;
};

}
