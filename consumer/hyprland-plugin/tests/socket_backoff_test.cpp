#include "../src/vivid_socket.hpp"
#include "../src/vivid_protocol.hpp"

#include <cassert>
#include <cerrno>
#include <chrono>
#include <cstdio>
#include <string>
#include <sys/socket.h>
#include <vector>

using vivid::hyprland::PointerMotion;
using vivid::hyprland::VividSocketClient;

namespace {

uint16_t read_u16(const std::vector<uint8_t>& bytes, size_t offset) {
    return uint16_t(bytes[offset]) | (uint16_t(bytes[offset + 1]) << 8);
}

struct FakeSocketOps {
    int socketCalls = 0;
    int connectCalls = 0;
    int closeCalls = 0;
    int getsockoptCalls = 0;

    int socketErrno = 0;
    int connectErrno = ENOENT;
    int getsockoptErrno = 0;

    bool connectSucceeds = false;

    std::vector<uint8_t> bytes;

    int socket(int, int, int) {
        ++socketCalls;
        if (socketErrno != 0) {
            errno = socketErrno;
            return -1;
        }
        return 100 + socketCalls;
    }

    int connect(int, const struct sockaddr*, socklen_t) {
        ++connectCalls;
        if (connectSucceeds) {
            return 0;
        }
        errno = connectErrno;
        return -1;
    }

    int getsockopt(int, int, int, void* optval, socklen_t* optlen) {
        ++getsockoptCalls;
        assert(*optlen == sizeof(int));
        *static_cast<int*>(optval) = getsockoptErrno;
        return 0;
    }

    int close(int) {
        ++closeCalls;
        return 0;
    }
};

std::string oversizedSocketPath() {
    return std::string(108, 'x');
}

} // namespace

int main() {
    using namespace std::chrono_literals;

    // Failed connects should back off instead of creating a socket per flush.
    {
        FakeSocketOps ops;
        auto now = std::chrono::steady_clock::time_point{};
        VividSocketClient client(
            "missing.sock",
            [&]() { return now; },
            {
                .socket = [&](int domain, int type, int protocol) { return ops.socket(domain, type, protocol); },
                .connect = [&](int fd, const struct sockaddr* addr, socklen_t len) { return ops.connect(fd, addr, len); },
                .getsockopt = [&](int fd, int level, int name, void* value, socklen_t* len) {
                    return ops.getsockopt(fd, level, name, value, len);
                },
                .close = [&](int fd) { return ops.close(fd); },
            });

        client.enqueueMotion(7, {1.0, 2.0, 3});
        client.flush();
        client.flush();
        client.flush();

        assert(ops.socketCalls == 1);
        assert(ops.connectCalls == 1);
        assert(ops.closeCalls == 1);

        now += 249ms;
        client.flush();
        assert(ops.socketCalls == 1);

        now += 1ms;
        client.flush();
        assert(ops.socketCalls == 2);
        assert(ops.connectCalls == 2);
    }

    // socket() allocation failure must also enter backoff to avoid fd-churn retry loops.
    {
        FakeSocketOps ops;
        ops.socketErrno = EMFILE;
        auto now = std::chrono::steady_clock::time_point{};
        VividSocketClient client(
            "fd-budget.sock",
            [&]() { return now; },
            {
                .socket = [&](int domain, int type, int protocol) { return ops.socket(domain, type, protocol); },
                .connect = [&](int fd, const struct sockaddr* addr, socklen_t len) { return ops.connect(fd, addr, len); },
                .getsockopt = [&](int fd, int level, int name, void* value, socklen_t* len) {
                    return ops.getsockopt(fd, level, name, value, len);
                },
                .close = [&](int fd) { return ops.close(fd); },
            });

        client.enqueueMotion(11, {3.0, 4.0, 5});
        client.flush();
        client.flush();
        client.flush();

        assert(ops.socketCalls == 1);
        assert(ops.connectCalls == 0);
        assert(ops.closeCalls == 0);

        now += 249ms;
        client.flush();
        assert(ops.socketCalls == 1);

        now += 1ms;
        client.flush();
        assert(ops.socketCalls == 2);
        assert(ops.connectCalls == 0);
    }

    // Oversized socket paths must also back off instead of allocating/closing on every flush.
    {
        FakeSocketOps ops;
        auto now = std::chrono::steady_clock::time_point{};
        VividSocketClient client(
            oversizedSocketPath(),
            [&]() { return now; },
            {
                .socket = [&](int domain, int type, int protocol) { return ops.socket(domain, type, protocol); },
                .connect = [&](int fd, const struct sockaddr* addr, socklen_t len) { return ops.connect(fd, addr, len); },
                .getsockopt = [&](int fd, int level, int name, void* value, socklen_t* len) {
                    return ops.getsockopt(fd, level, name, value, len);
                },
                .close = [&](int fd) { return ops.close(fd); },
            });

        client.enqueueMotion(13, {5.0, 6.0, 7});
        client.flush();
        client.flush();
        client.flush();

        assert(ops.socketCalls == 1);
        assert(ops.connectCalls == 0);
        assert(ops.closeCalls == 1);

        now += 249ms;
        client.flush();
        assert(ops.socketCalls == 1);
        assert(ops.closeCalls == 1);

        now += 1ms;
        client.flush();
        assert(ops.socketCalls == 2);
        assert(ops.closeCalls == 2);
    }

    // Moving a client with scheduled backoff must preserve retry suppression.
    {
        FakeSocketOps ops;
        ops.socketErrno = ENFILE;
        auto now = std::chrono::steady_clock::time_point{};
        VividSocketClient original(
            "move-backoff.sock",
            [&]() { return now; },
            {
                .socket = [&](int domain, int type, int protocol) { return ops.socket(domain, type, protocol); },
                .connect = [&](int fd, const struct sockaddr* addr, socklen_t len) { return ops.connect(fd, addr, len); },
                .getsockopt = [&](int fd, int level, int name, void* value, socklen_t* len) {
                    return ops.getsockopt(fd, level, name, value, len);
                },
                .close = [&](int fd) { return ops.close(fd); },
            });

        original.enqueueMotion(19, {8.0, 9.0, 10});
        original.flush();
        assert(ops.socketCalls == 1);

        VividSocketClient moved(std::move(original));
        moved.flush();
        assert(ops.socketCalls == 1);

        now += 250ms;
        moved.flush();
        assert(ops.socketCalls == 2);
    }

    // Moving a client with an owned live fd must transfer ownership and close exactly once.
    {
        FakeSocketOps ops;
        auto now = std::chrono::steady_clock::time_point{};
        {
            VividSocketClient original(
                "owned-fd.sock",
                [&]() { return now; },
                {
                    .socket = [&](int domain, int type, int protocol) { return ops.socket(domain, type, protocol); },
                    .connect = [&](int fd, const struct sockaddr* addr, socklen_t len) { return ops.connect(fd, addr, len); },
                    .getsockopt = [&](int fd, int level, int name, void* value, socklen_t* len) {
                        return ops.getsockopt(fd, level, name, value, len);
                    },
                    .close = [&](int fd) { return ops.close(fd); },
                });

            original.flush();
            assert(ops.socketCalls == 1);
            assert(ops.connectCalls == 1);

            VividSocketClient moved(std::move(original));
            moved.close();
            assert(ops.closeCalls == 1);
        }

        assert(ops.closeCalls == 1);
    }

    // A successful connection should reset the backoff window and still send HELLO first.
    {
        FakeSocketOps ops;
        auto now = std::chrono::steady_clock::time_point{};
        VividSocketClient client(
            "recover.sock",
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
                ops.bytes.insert(ops.bytes.end(), data, data + size);
                return static_cast<ssize_t>(size);
            });

        client.enqueueMotion(17, {10.0, 20.0, 123});
        client.flush();
        assert(ops.socketCalls == 1);
        assert(ops.connectCalls == 1);

        now += 250ms;
        ops.connectSucceeds = true;
        client.flush();
        assert(ops.socketCalls == 2);
        assert(ops.connectCalls == 2);
        assert(read_u16(ops.bytes, 0) == vivid::hyprland::REQ_HELLO);

        client.close();
        client.enqueueMotion(17, {11.0, 21.0, 124});
        client.flush();

        assert(ops.socketCalls == 3);
        assert(ops.connectCalls == 3);
        assert(read_u16(ops.bytes, read_u16(ops.bytes, 2)) == vivid::hyprland::REQ_POINTER_MOTION);
    }

    std::printf("All socket backoff tests passed.\n");
    return 0;
}
