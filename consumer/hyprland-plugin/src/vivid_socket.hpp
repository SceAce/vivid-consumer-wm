#pragma once

#include <cstddef>
#include <cstdint>
#include <deque>
#include <functional>
#include <chrono>
#include <string>
#include <sys/socket.h>
#include <sys/types.h>
#include <vector>

namespace vivid::hyprland {

struct PointerMotion {
    double x = 0.0;
    double y = 0.0;
    uint64_t timeUsec = 0;
};

struct QueuedMotion {
    uint32_t outputId = 0;
    PointerMotion motion;
};

class SocketQueue {
  public:
    explicit SocketQueue(size_t capacity = 64);
    void enqueueMotion(uint32_t outputId, PointerMotion motion);
    void push_front(QueuedMotion item);
    [[nodiscard]] bool empty() const;
    [[nodiscard]] size_t size() const;
    [[nodiscard]] const QueuedMotion& front() const;
    QueuedMotion pop();

  private:
    size_t m_capacity = 64;
    std::deque<QueuedMotion> m_items;
};

class VividSocketClient {
  public:
    using SendCallback = std::function<ssize_t(const uint8_t*, size_t)>;
    using NowCallback = std::function<std::chrono::steady_clock::time_point()>;

    struct SocketOps {
        std::function<int(int, int, int)> socket;
        std::function<int(int, const struct sockaddr*, socklen_t)> connect;
        std::function<int(int, int, int, void*, socklen_t*)> getsockopt;
        std::function<int(int)> close;
    };

    explicit VividSocketClient(std::string socketPath);
    // Takes ownership of connectedFd and closes it when the client closes or is destroyed.
    VividSocketClient(std::string socketPath, int connectedFd);
    VividSocketClient(std::string socketPath, SendCallback sendCallback);
    VividSocketClient(std::string socketPath, NowCallback nowCallback, SocketOps socketOps,
                      SendCallback sendCallback = {});
    ~VividSocketClient();

    VividSocketClient(const VividSocketClient&) = delete;
    VividSocketClient& operator=(const VividSocketClient&) = delete;
    VividSocketClient(VividSocketClient&& other) noexcept;
    VividSocketClient& operator=(VividSocketClient&& other) noexcept;

    void setSocketPath(std::string socketPath);
    void enqueueMotion(uint32_t outputId, PointerMotion motion);
    void flush();
    void close();

  private:
    void tryConnect();
    void completeConnect();
    void markRetryNeeded();
    [[nodiscard]] std::chrono::steady_clock::time_point now() const;

    std::string m_socketPath;
    int m_fd = -1;
    bool m_ownsFd = true;
    SendCallback m_sendOverride;
    NowCallback m_nowCallback;
    SocketOps m_socketOps;
    SocketQueue m_queue;
    bool m_connected = false;
    bool m_helloSent = false;

    bool m_hasPendingItem = false;
    uint32_t m_pendingOutputId = 0;
    PointerMotion m_pendingMotion;

    std::vector<uint8_t> m_pendingFrame;
    size_t m_pendingOffset = 0;

    std::chrono::steady_clock::time_point m_nextConnectAttempt{};
    std::chrono::milliseconds m_reconnectDelay{250};
    static constexpr std::chrono::milliseconds kInitialReconnectDelay{250};
    static constexpr std::chrono::milliseconds kMaxReconnectDelay{2000};
};

}
