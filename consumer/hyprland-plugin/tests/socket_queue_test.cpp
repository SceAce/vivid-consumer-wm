#include "../src/vivid_socket.hpp"
#include "../src/vivid_protocol.hpp"

#include <cassert>
#include <cerrno>
#include <chrono>
#include <cstdio>
#include <string>
#include <sys/socket.h>
#include <vector>

static uint16_t read_u16(const std::vector<uint8_t>& bytes, size_t offset) {
    return uint16_t(bytes[offset]) | (uint16_t(bytes[offset + 1]) << 8);
}

namespace {

struct FakeSocketOps {
    int socketCalls = 0;
    int connectCalls = 0;
    int closeCalls = 0;

    int socket(int, int, int) {
        ++socketCalls;
        return 100 + socketCalls;
    }

    int connect(int, const struct sockaddr*, socklen_t) {
        ++connectCalls;
        return 0;
    }

    int getsockopt(int, int, int, void*, socklen_t*) {
        return 0;
    }

    int close(int) {
        ++closeCalls;
        return 0;
    }
};

} // namespace

int main() {
    // Basic coalescing: later motion for same output replaces earlier
    {
        vivid::hyprland::SocketQueue queue;
        queue.enqueueMotion(17, {1, 1, 100});
        queue.enqueueMotion(17, {2, 2, 200});
        queue.enqueueMotion(22, {5, 5, 500});
        assert(queue.size() == 2);
        const auto first = queue.pop();
        const auto second = queue.pop();
        assert(first.outputId == 17);
        assert(first.motion.x == 2);
        assert(first.motion.y == 2);
        assert(first.motion.timeUsec == 200);
        assert(second.outputId == 22);
    }

    // push_front: item is placed at front and popped next
    {
        vivid::hyprland::SocketQueue queue;
        queue.enqueueMotion(1, {10, 10, 100});
        assert(queue.size() == 1);
        queue.push_front({2, {20, 20, 200}});
        assert(queue.size() == 2);
        const auto first = queue.pop();
        assert(first.outputId == 2); // push_front puts this at front
        const auto second = queue.pop();
        assert(second.outputId == 1);
    }

    // push_front with coalescing: simulate the error-recovery scenario
    // where a pending item is popped, then a new motion for the same output is
    // enqueued (not coalesced since the original entry was removed),
    // then push_front restores the pending item before the newer entry
    {
        vivid::hyprland::SocketQueue queue;
        queue.enqueueMotion(1, {10, 10, 100});
        queue.enqueueMotion(2, {20, 20, 200});

        // Pop output 1 — it becomes "pending" (as VividSocketClient does)
        auto pendingItem = queue.pop();
        assert(pendingItem.outputId == 1 && pendingItem.motion.x == 10);
        assert(queue.size() == 1);

        // A new motion for output 1 arrives — creates a new queue entry
        queue.enqueueMotion(1, {15, 15, 150});
        assert(queue.size() == 2);

        // The first remaining item is output 2
        const auto r1 = queue.pop();
        assert(r1.outputId == 2 && r1.motion.x == 20);

        // The second is the newer motion for output 1
        const auto r2 = queue.pop();
        assert(r2.outputId == 1 && r2.motion.x == 15);

        // Error recovery: push_front the old pending item back
        queue.push_front({1, {10, 10, 100}});
        assert(queue.size() == 1);
        const auto r3 = queue.pop();
        assert(r3.outputId == 1 && r3.motion.x == 10);
    }

    // push_front with capacity eviction: the queue drops oldest when full
    {
        vivid::hyprland::SocketQueue queue(2);
        queue.enqueueMotion(1, {1, 1, 100});
        queue.enqueueMotion(2, {2, 2, 200});
        assert(queue.size() == 2);
        // push_front on full queue evicts from back
        queue.push_front({3, {3, 3, 300}});
        assert(queue.size() == 2);
        const auto first = queue.pop();
        assert(first.outputId == 3); // push_front is at front
        const auto second = queue.pop();
        assert(second.outputId == 1); // outputId 2 was evicted from back
    }

    // Socket client must send HELLO before the first motion frame on each connection.
    {
        std::vector<uint8_t> bytes;
        vivid::hyprland::VividSocketClient client("capture-test",
            [&](const uint8_t* data, size_t size) -> ssize_t {
                bytes.insert(bytes.end(), data, data + size);
                return static_cast<ssize_t>(size);
            });
        client.enqueueMotion(17, {10, 20, 123456789});
        client.flush();

        assert(read_u16(bytes, 0) == vivid::hyprland::REQ_HELLO);
        const size_t helloSize = read_u16(bytes, 2);
        assert(helloSize > vivid::hyprland::FRAME_HEADER_BYTES);
        assert(bytes.size() == helloSize + vivid::hyprland::FRAME_HEADER_BYTES + vivid::hyprland::POINTER_MOTION_BODY_BYTES);
        assert(read_u16(bytes, helloSize) == vivid::hyprland::REQ_POINTER_MOTION);
    }

    // On send error, the pending motion is requeued and retried after reconnect.
    {
        using namespace std::chrono_literals;

        int calls = 0;
        std::vector<uint8_t> bytes;
        FakeSocketOps ops;
        auto now = std::chrono::steady_clock::time_point{};
        vivid::hyprland::VividSocketClient client(
            "capture-test",
            [&]() { return now; },
            {
                .socket = [&](int domain, int type, int protocol) { return ops.socket(domain, type, protocol); },
                .connect = [&](int fd, const struct sockaddr* addr, socklen_t len) { return ops.connect(fd, addr, len); },
                .getsockopt = [&](int fd, int level, int name, void* value, socklen_t* len) {
                    return ops.getsockopt(fd, level, name, value, len);
                },
                .close = [&](int fd) { return ops.close(fd); },
            },
            [&](const uint8_t* data, size_t size) -> ssize_t {
                ++calls;
                if (calls == 2) {
                    errno = EPIPE;
                    return -1;
                }
                bytes.insert(bytes.end(), data, data + size);
                return static_cast<ssize_t>(size);
            });
        client.enqueueMotion(17, {10, 20, 123456789});
        client.flush();
        now += 250ms;
        client.flush();

        const size_t firstHelloSize = read_u16(bytes, 2);
        assert(read_u16(bytes, 0) == vivid::hyprland::REQ_HELLO);
        assert(read_u16(bytes, firstHelloSize) == vivid::hyprland::REQ_HELLO);
        assert(read_u16(bytes, firstHelloSize + read_u16(bytes, firstHelloSize + 2)) == vivid::hyprland::REQ_POINTER_MOTION);
    }

    // EAGAIN on a motion frame keeps the connection and pending frame for retry.
    {
        int calls = 0;
        std::vector<uint8_t> bytes;
        vivid::hyprland::VividSocketClient client("capture-test",
            [&](const uint8_t* data, size_t size) -> ssize_t {
                ++calls;
                if (calls == 2) {
                    errno = EAGAIN;
                    return -1;
                }
                bytes.insert(bytes.end(), data, data + size);
                return static_cast<ssize_t>(size);
            });
        client.enqueueMotion(17, {30, 40, 987654321});
        client.flush();
        client.flush();

        const size_t helloSize = read_u16(bytes, 2);
        assert(read_u16(bytes, 0) == vivid::hyprland::REQ_HELLO);
        assert(read_u16(bytes, helloSize) == vivid::hyprland::REQ_POINTER_MOTION);
    }

    std::printf("All socket queue tests passed.\n");
    return 0;
}
