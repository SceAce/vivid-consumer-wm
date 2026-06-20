#pragma once

#include <cstddef>
#include <cstdint>
#include <cstring>
#include <vector>

namespace vivid::hyprland {

constexpr uint16_t REQ_HELLO = 1;
constexpr uint16_t REQ_POINTER_MOTION = 7;
constexpr size_t POINTER_MOTION_BODY_BYTES = 28;
constexpr size_t FRAME_HEADER_BYTES = 4;

inline void writeU16LE(std::vector<uint8_t>& out, size_t offset, uint16_t value) {
    out[offset] = uint8_t(value & 0xff);
    out[offset + 1] = uint8_t((value >> 8) & 0xff);
}

inline void writeU32LE(std::vector<uint8_t>& out, size_t offset, uint32_t value) {
    out[offset] = uint8_t(value & 0xff);
    out[offset + 1] = uint8_t((value >> 8) & 0xff);
    out[offset + 2] = uint8_t((value >> 16) & 0xff);
    out[offset + 3] = uint8_t((value >> 24) & 0xff);
}

inline void writeU64LE(std::vector<uint8_t>& out, size_t offset, uint64_t value) {
    writeU32LE(out, offset, uint32_t(value & 0xffffffffu));
    writeU32LE(out, offset + 4, uint32_t((value >> 32) & 0xffffffffu));
}

inline void writeF64LE(std::vector<uint8_t>& out, size_t offset, double value) {
    static_assert(__BYTE_ORDER__ == __ORDER_LITTLE_ENDIAN__, "Vivid protocol encoder expects little-endian host");
    std::memcpy(out.data() + offset, &value, sizeof(double));
}

inline std::vector<uint8_t> encodePointerMotion(uint32_t outputId, double x, double y, uint64_t timeUsec) {
    std::vector<uint8_t> frame(FRAME_HEADER_BYTES + POINTER_MOTION_BODY_BYTES);
    writeU16LE(frame, 0, REQ_POINTER_MOTION);
    writeU16LE(frame, 2, uint16_t(frame.size()));
    writeU32LE(frame, 4, outputId);
    writeF64LE(frame, 8, x);
    writeF64LE(frame, 16, y);
    writeU64LE(frame, 24, timeUsec);
    return frame;
}

inline std::vector<uint8_t> encodeJsonFrame(uint16_t opcode, const char* json) {
    const size_t bodySize = std::strlen(json);
    std::vector<uint8_t> frame(FRAME_HEADER_BYTES + bodySize);
    writeU16LE(frame, 0, opcode);
    writeU16LE(frame, 2, uint16_t(frame.size()));
    std::memcpy(frame.data() + FRAME_HEADER_BYTES, json, bodySize);
    return frame;
}

inline std::vector<uint8_t> encodeHello() {
    return encodeJsonFrame(
        REQ_HELLO,
        R"({"type":"REQ_HELLO","protocol":"vivid-display-v1","version":1,"role":"controller","clientName":"vivid-hyprland-bridge","features":["pointer-events-v1"]})"
    );
}

}
