#include "../src/vivid_bridge.hpp"

#include <cassert>
#include <string>

int main() {
    // No hash configured anywhere → pass (no hash check required)
    assert(vivid::hyprland::checkHashPolicy("", "", "abc123") == true);

    // Configured hash matches running → pass
    assert(vivid::hyprland::checkHashPolicy("abc123", "", "abc123") == true);

    // Configured hash does not match running → fail
    assert(vivid::hyprland::checkHashPolicy("abc123", "", "def456") == false);

    // Compiled hash matches running → pass
    assert(vivid::hyprland::checkHashPolicy("", "abc123", "abc123") == true);

    // Compiled hash does not match running → fail
    assert(vivid::hyprland::checkHashPolicy("", "abc123", "def456") == false);

    // Configured overrides compiled → use configured
    assert(vivid::hyprland::checkHashPolicy("abc123", "compiled_hash", "abc123") == true);
    assert(vivid::hyprland::checkHashPolicy("abc123", "compiled_hash", "compiled_hash") == false);

    // Unavailable runtime hash should not block registration on its own
    assert(vivid::hyprland::checkHashPolicy("", "", "") == true);
    assert(vivid::hyprland::checkHashPolicy("abc123", "", "") == false);
    assert(vivid::hyprland::checkHashPolicy("", "compiled_hash", "") == false);

    // All empty → pass
    return 0;
}
