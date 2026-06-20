#include "output_map.hpp"
#include "pointer_debug.hpp"

#include <cctype>
#include <fstream>
#include <limits>
#include <sstream>
#include <unordered_set>

namespace vivid::hyprland {

namespace {

class JsonCursor {
  public:
    explicit JsonCursor(const std::string& text) : m_text(text) {}

    bool consume(char expected) {
        skipSpace();
        if (peek() != expected)
            return false;
        ++m_pos;
        return true;
    }

    bool consumeString(const char* expected) {
        std::string value;
        if (!readString(value))
            return false;
        return value == expected;
    }

    bool readString(std::string& out) {
        skipSpace();
        if (peek() != '"')
            return false;
        ++m_pos;
        out.clear();
        while (m_pos < m_text.size()) {
            const char ch = m_text[m_pos++];
            if (ch == '"')
                return true;
            if (ch == '\\') {
                if (m_pos >= m_text.size())
                    return false;
                const char escaped = m_text[m_pos++];
                switch (escaped) {
                case '"':
                case '\\':
                case '/':
                    out.push_back(escaped);
                    break;
                case 'b':
                    out.push_back('\b');
                    break;
                case 'f':
                    out.push_back('\f');
                    break;
                case 'n':
                    out.push_back('\n');
                    break;
                case 'r':
                    out.push_back('\r');
                    break;
                case 't':
                    out.push_back('\t');
                    break;
                default:
                    return false;
                }
            } else {
                out.push_back(ch);
            }
        }
        return false;
    }

    bool readUint32(uint32_t& out) {
        skipSpace();
        if (m_pos >= m_text.size() || !std::isdigit(static_cast<unsigned char>(m_text[m_pos])))
            return false;

        uint64_t value = 0;
        while (m_pos < m_text.size() && std::isdigit(static_cast<unsigned char>(m_text[m_pos]))) {
            value = value * 10 + static_cast<uint64_t>(m_text[m_pos] - '0');
            if (value > std::numeric_limits<uint32_t>::max())
                return false;
            ++m_pos;
        }
        out = static_cast<uint32_t>(value);
        return true;
    }

    bool finished() {
        skipSpace();
        return m_pos == m_text.size();
    }

  private:
    char peek() const {
        return m_pos < m_text.size() ? m_text[m_pos] : '\0';
    }

    void skipSpace() {
        while (m_pos < m_text.size() && std::isspace(static_cast<unsigned char>(m_text[m_pos])))
            ++m_pos;
    }

    const std::string& m_text;
    size_t m_pos = 0;
};

bool parseOutputEntry(JsonCursor& cursor, std::string& monitorName, uint32_t& outputId) {
    if (!cursor.consume('{'))
        return false;
    if (!cursor.consumeString("monitorName") || !cursor.consume(':') || !cursor.readString(monitorName))
        return false;
    if (!cursor.consume(','))
        return false;
    if (!cursor.consumeString("outputId") || !cursor.consume(':') || !cursor.readUint32(outputId))
        return false;
    return cursor.consume('}');
}

} // namespace

void OutputMap::setMonitorOutputId(const std::string& monitorName, uint32_t outputId) {
    if (monitorName.empty() || outputId == 0)
        return;
    std::lock_guard lock(m_mutex);
    m_byMonitorName[monitorName] = outputId;
}

std::optional<uint32_t> OutputMap::outputIdForMonitor(const std::string& monitorName) const {
    std::lock_guard lock(m_mutex);
    const auto it = m_byMonitorName.find(monitorName);
    if (it == m_byMonitorName.end()) {
        static std::mutex s_debugMutex;
        static std::unordered_set<std::string> s_loggedMisses;
        if (pointerDebugEnabled()) {
            std::lock_guard debugLock(s_debugMutex);
            if (s_loggedMisses.insert(monitorName).second) {
                pointerDebugLog("output-map.miss", {
                    {"monitor", monitorName},
                    {"reason", "monitor_not_mapped"},
                });
            }
        }
        return std::nullopt;
    }
    return it->second;
}

bool OutputMap::loadFromFile(const std::string& path) {
    std::ifstream file(path);
    if (!file) {
        clear();
        return false;
    }

    std::ostringstream buffer;
    buffer << file.rdbuf();
    return loadFromJson(buffer.str());
}

bool OutputMap::loadFromJson(const std::string& json) {
    JsonCursor cursor(json);
    uint32_t version = 0;
    std::unordered_map<std::string, uint32_t> next;

    auto fail = [&]() {
        clear();
        return false;
    };

    if (!cursor.consume('{'))
        return fail();
    if (!cursor.consumeString("version") || !cursor.consume(':') || !cursor.readUint32(version))
        return fail();
    if (version != 1)
        return fail();
    if (!cursor.consume(','))
        return fail();
    if (!cursor.consumeString("outputs") || !cursor.consume(':') || !cursor.consume('['))
        return fail();

    if (!cursor.consume(']')) {
        while (true) {
            std::string monitorName;
            uint32_t outputId = 0;
            if (!parseOutputEntry(cursor, monitorName, outputId))
                return fail();
            if (!monitorName.empty() && outputId > 0)
                next[monitorName] = outputId;
            if (cursor.consume(']'))
                break;
            if (!cursor.consume(','))
                return fail();
        }
    }

    if (!cursor.consume('}') || !cursor.finished())
        return fail();

    replaceWith(std::move(next));
    return true;
}

void OutputMap::clear() {
    std::lock_guard lock(m_mutex);
    m_byMonitorName.clear();
}

void OutputMap::replaceWith(std::unordered_map<std::string, uint32_t> next) {
    std::lock_guard lock(m_mutex);
    m_byMonitorName = std::move(next);
}

}
