#include "../src/vivid_protocol.hpp"

#include <cassert>
#include <cmath>
#include <cstdint>
#include <string>
#include <vector>

static uint16_t read_u16(const std::vector<uint8_t>& bytes, size_t offset) {
    return uint16_t(bytes[offset]) | (uint16_t(bytes[offset + 1]) << 8);
}

static uint32_t read_u32(const std::vector<uint8_t>& bytes, size_t offset) {
    return uint32_t(bytes[offset]) |
           (uint32_t(bytes[offset + 1]) << 8) |
           (uint32_t(bytes[offset + 2]) << 16) |
           (uint32_t(bytes[offset + 3]) << 24);
}

static uint64_t read_u64(const std::vector<uint8_t>& bytes, size_t offset) {
    return uint64_t(read_u32(bytes, offset)) |
           (uint64_t(read_u32(bytes, offset + 4)) << 32);
}

static double read_f64(const std::vector<uint8_t>& bytes, size_t offset) {
    double value = 0.0;
    uint8_t* out = reinterpret_cast<uint8_t*>(&value);
    for (size_t i = 0; i < sizeof(double); ++i)
        out[i] = bytes[offset + i];
    return value;
}

int main() {
    const auto hello = vivid::hyprland::encodeHello();
    assert(hello.size() > 4);
    assert(read_u16(hello, 0) == vivid::hyprland::REQ_HELLO);
    assert(read_u16(hello, 2) == hello.size());
    const std::string helloBody(reinterpret_cast<const char*>(hello.data() + 4), hello.size() - 4);
    assert(helloBody.find(R"("type":"REQ_HELLO")") != std::string::npos);
    assert(helloBody.find(R"("protocol":"vivid-display-v1")") != std::string::npos);
    assert(helloBody.find(R"("version":1)") != std::string::npos);
    assert(helloBody.find(R"("role":"controller")") != std::string::npos);
    assert(helloBody.find(R"("clientName":"vivid-hyprland-bridge")") != std::string::npos);
    assert(helloBody.find(R"("features":["pointer-events-v1"])") != std::string::npos);

    const auto frame = vivid::hyprland::encodePointerMotion(17, 15.5, 30.25, 123456789);
    assert(frame.size() == 32);
    assert(read_u16(frame, 0) == 7);
    assert(read_u16(frame, 2) == 32);
    assert(read_u32(frame, 4) == 17);
    assert(std::fabs(read_f64(frame, 8) - 15.5) < 0.00001);
    assert(std::fabs(read_f64(frame, 16) - 30.25) < 0.00001);
    assert(read_u64(frame, 24) == 123456789);
    return 0;
}
