#include "vivid_socket.hpp"
#include "pointer_debug.hpp"
#include "vivid_protocol.hpp"

#include <algorithm>
#include <cerrno>
#include <chrono>
#include <cstring>
#include <stdexcept>
#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

namespace vivid::hyprland {

namespace {

const char* socketErrorCategory(int err) {
    if (err == EAGAIN || err == EWOULDBLOCK)
        return "would_block";
    if (err == ECONNREFUSED)
        return "connect_refused";
    if (err == ENOENT)
        return "path_missing";
    if (err == EPIPE)
        return "peer_closed";
    return "io_error";
}

void logSocketFailure(const char* event, int err) {
    pointerDebugLog(event, {
        {"errno", std::to_string(err)},
        {"category", socketErrorCategory(err)},
    });
}

} // namespace

SocketQueue::SocketQueue(size_t capacity) : m_capacity(capacity == 0 ? 1 : capacity) {}

void SocketQueue::enqueueMotion(uint32_t outputId, PointerMotion motion) {
    for (auto it = m_items.rbegin(); it != m_items.rend(); ++it) {
        if (it->outputId == outputId) {
            it->motion = motion;
            return;
        }
    }

    if (m_items.size() >= m_capacity)
        m_items.pop_front();

    m_items.push_back({outputId, motion});
}

void SocketQueue::push_front(QueuedMotion item) {
    if (m_items.size() >= m_capacity)
        m_items.pop_back();
    m_items.push_front(std::move(item));
}

bool SocketQueue::empty() const {
    return m_items.empty();
}

size_t SocketQueue::size() const {
    return m_items.size();
}

const QueuedMotion& SocketQueue::front() const {
    if (m_items.empty())
        throw std::out_of_range("SocketQueue::front on empty queue");
    return m_items.front();
}

QueuedMotion SocketQueue::pop() {
    if (m_items.empty())
        throw std::out_of_range("SocketQueue::pop on empty queue");
    auto item = m_items.front();
    m_items.pop_front();
    return item;
}

VividSocketClient::VividSocketClient(std::string socketPath)
    : m_socketPath(std::move(socketPath))
    , m_nowCallback([] { return std::chrono::steady_clock::now(); })
{
    m_socketOps.socket = [](int domain, int type, int protocol) {
        return ::socket(domain, type, protocol);
    };
    m_socketOps.connect = [](int fd, const struct sockaddr* addr, socklen_t len) {
        return ::connect(fd, addr, len);
    };
    m_socketOps.getsockopt = [](int fd, int level, int name, void* value, socklen_t* len) {
        return ::getsockopt(fd, level, name, value, len);
    };
    m_socketOps.close = [](int fd) {
        return ::close(fd);
    };
}

VividSocketClient::VividSocketClient(std::string socketPath, int connectedFd)
    : VividSocketClient(std::move(socketPath))
{
    m_fd = connectedFd;
    m_connected = connectedFd >= 0;
}

VividSocketClient::VividSocketClient(std::string socketPath, SendCallback sendCallback)
    : VividSocketClient(std::move(socketPath))
{
    m_fd = 0;
    m_ownsFd = false;
    m_sendOverride = std::move(sendCallback);
    m_connected = true;
}

VividSocketClient::VividSocketClient(std::string socketPath, NowCallback nowCallback,
                                     SocketOps socketOps, SendCallback sendCallback)
    : VividSocketClient(std::move(socketPath))
{
    if (nowCallback)
        m_nowCallback = std::move(nowCallback);
    if (socketOps.socket)
        m_socketOps.socket = std::move(socketOps.socket);
    if (socketOps.connect)
        m_socketOps.connect = std::move(socketOps.connect);
    if (socketOps.getsockopt)
        m_socketOps.getsockopt = std::move(socketOps.getsockopt);
    if (socketOps.close)
        m_socketOps.close = std::move(socketOps.close);
    m_sendOverride = std::move(sendCallback);
}

VividSocketClient::~VividSocketClient() {
    close();
}

VividSocketClient::VividSocketClient(VividSocketClient&& other) noexcept
    : m_socketPath(std::move(other.m_socketPath))
    , m_fd(other.m_fd)
    , m_ownsFd(other.m_ownsFd)
    , m_sendOverride(std::move(other.m_sendOverride))
    , m_nowCallback(std::move(other.m_nowCallback))
    , m_socketOps(std::move(other.m_socketOps))
    , m_queue(std::move(other.m_queue))
    , m_connected(other.m_connected)
    , m_helloSent(other.m_helloSent)
    , m_hasPendingItem(other.m_hasPendingItem)
    , m_pendingOutputId(other.m_pendingOutputId)
    , m_pendingMotion(other.m_pendingMotion)
    , m_pendingFrame(std::move(other.m_pendingFrame))
    , m_pendingOffset(other.m_pendingOffset)
    , m_nextConnectAttempt(other.m_nextConnectAttempt)
    , m_reconnectDelay(other.m_reconnectDelay)
{
    other.m_fd = -1;
    other.m_ownsFd = true;
    other.m_connected = false;
    other.m_helloSent = false;
    other.m_hasPendingItem = false;
    other.m_pendingOffset = 0;
}

VividSocketClient& VividSocketClient::operator=(VividSocketClient&& other) noexcept {
    if (this != &other) {
        close();
        m_socketPath = std::move(other.m_socketPath);
        m_fd = other.m_fd;
        other.m_fd = -1;
        m_ownsFd = other.m_ownsFd;
        other.m_ownsFd = true;
        m_sendOverride = std::move(other.m_sendOverride);
        m_nowCallback = std::move(other.m_nowCallback);
        m_socketOps = std::move(other.m_socketOps);
        m_queue = std::move(other.m_queue);
        m_connected = other.m_connected;
        other.m_connected = false;
        m_helloSent = other.m_helloSent;
        other.m_helloSent = false;
        m_hasPendingItem = other.m_hasPendingItem;
        other.m_hasPendingItem = false;
        m_pendingOutputId = other.m_pendingOutputId;
        m_pendingMotion = other.m_pendingMotion;
        m_pendingFrame = std::move(other.m_pendingFrame);
        m_pendingOffset = other.m_pendingOffset;
        other.m_pendingOffset = 0;
        m_nextConnectAttempt = other.m_nextConnectAttempt;
        m_reconnectDelay = other.m_reconnectDelay;
    }
    return *this;
}

void VividSocketClient::setSocketPath(std::string socketPath) {
    close();
    m_socketPath = std::move(socketPath);
    m_nextConnectAttempt = {};
    m_reconnectDelay = kInitialReconnectDelay;
}

void VividSocketClient::enqueueMotion(uint32_t outputId, PointerMotion motion) {
    m_queue.enqueueMotion(outputId, motion);
}

std::chrono::steady_clock::time_point VividSocketClient::now() const {
    return m_nowCallback ? m_nowCallback() : std::chrono::steady_clock::now();
}

void VividSocketClient::markRetryNeeded() {
    m_nextConnectAttempt = now() + m_reconnectDelay;
    m_reconnectDelay = std::min(m_reconnectDelay * 2, kMaxReconnectDelay);
}

void VividSocketClient::flush() {
    // Try connecting if not connected
    if (m_fd < 0) {
        if (now() < m_nextConnectAttempt)
            return;
        tryConnect();
        if (m_fd < 0)
            return;
    }

    // If connect was EINPROGRESS, check completion
    if (!m_connected) {
        completeConnect();
        if (m_fd < 0 || !m_connected)
            return;
    }

    // Process items until queue is drained or we block on send
    while (true) {
        if (m_pendingFrame.empty()) {
            if (!m_helloSent) {
                m_pendingFrame = encodeHello();
            } else {
                // Pop the next item from the queue into pending state if nothing pending
                if (!m_hasPendingItem) {
                    if (m_queue.empty())
                        break;
                    auto item = m_queue.pop();
                    m_pendingOutputId = item.outputId;
                    m_pendingMotion = item.motion;
                    m_hasPendingItem = true;
                }

                m_pendingFrame = encodePointerMotion(m_pendingOutputId, m_pendingMotion.x,
                                                      m_pendingMotion.y, m_pendingMotion.timeUsec);
            }
            m_pendingOffset = 0;
        }

        const size_t remaining = m_pendingFrame.size() - m_pendingOffset;
        const auto* data = m_pendingFrame.data() + m_pendingOffset;

        const ssize_t sent = m_sendOverride
            ? m_sendOverride(data, remaining)
            : ::send(m_fd, data, remaining, MSG_DONTWAIT | MSG_NOSIGNAL);

        if (sent < 0) {
            logSocketFailure("socket.send", errno);
            if (errno == EAGAIN || errno == EWOULDBLOCK)
                return; // non-fatal, retry on next flush
            // Hard error: requeue pending item for retry, then close
            if (m_hasPendingItem) {
                m_queue.push_front({m_pendingOutputId, m_pendingMotion});
                m_hasPendingItem = false;
            }
            m_pendingFrame.clear();
            m_pendingOffset = 0;
            markRetryNeeded();
            close();
            return;
        }

        if (sent == 0) {
            // Peer closed connection: requeue pending item, then close
            pointerDebugLog("socket.send", {
                {"errno", "0"},
                {"category", "peer_closed"},
            });
            if (m_hasPendingItem) {
                m_queue.push_front({m_pendingOutputId, m_pendingMotion});
                m_hasPendingItem = false;
            }
            m_pendingFrame.clear();
            m_pendingOffset = 0;
            markRetryNeeded();
            close();
            return;
        }

        m_pendingOffset += static_cast<size_t>(sent);

        if (m_pendingOffset >= m_pendingFrame.size()) {
            if (!m_helloSent) {
                m_helloSent = true;
            } else {
                // Complete motion frame sent — pending item is consumed
                m_hasPendingItem = false;
            }
            m_pendingFrame.clear();
            m_pendingOffset = 0;
        } else {
            // Short write (partial frame); resume on next flush
            return;
        }
    }
}

void VividSocketClient::close() {
    if (m_fd >= 0 && m_ownsFd) {
        m_socketOps.close(m_fd);
    }
    m_fd = -1;
    m_connected = false;
    m_helloSent = false;
    if (m_hasPendingItem) {
        m_queue.push_front({m_pendingOutputId, m_pendingMotion});
        m_hasPendingItem = false;
    }
    m_pendingFrame.clear();
    m_pendingOffset = 0;
}

void VividSocketClient::tryConnect() {
    m_fd = m_socketOps.socket(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0);
    if (m_fd < 0) {
        logSocketFailure("socket.connect", errno);
        markRetryNeeded();
        return;
    }

    struct sockaddr_un addr{};
    addr.sun_family = AF_UNIX;

    if (m_socketPath.size() >= sizeof(addr.sun_path)) {
        pointerDebugLog("socket.connect", {
            {"errno", "0"},
            {"category", "path_too_long"},
        });
        markRetryNeeded();
        close();
        return;
    }
    std::strncpy(addr.sun_path, m_socketPath.c_str(), sizeof(addr.sun_path) - 1);

    const int ret = m_socketOps.connect(m_fd, reinterpret_cast<struct sockaddr*>(&addr), sizeof(addr));
    if (ret == 0) {
        m_connected = true;
        m_nextConnectAttempt = {};
        m_reconnectDelay = kInitialReconnectDelay;
        return; // connected immediately
    }

    if (errno == EINPROGRESS)
        return; // non-blocking connect in progress, keep fd

    // Non-fatal errors: server not running, retry on next flush
    if (errno == ENOENT || errno == ECONNREFUSED) {
        logSocketFailure("socket.connect", errno);
        markRetryNeeded();
        close();
        return;
    }

    // Hard error
    logSocketFailure("socket.connect", errno);
    markRetryNeeded();
    close();
}

void VividSocketClient::completeConnect() {
    int err = 0;
    socklen_t errlen = sizeof(err);
    if (m_socketOps.getsockopt(m_fd, SOL_SOCKET, SO_ERROR, &err, &errlen) < 0) {
        logSocketFailure("socket.connect", errno);
        markRetryNeeded();
        close();
        return;
    }
    if (err == EINPROGRESS)
        return; // still connecting
    if (err != 0) {
        logSocketFailure("socket.connect", err);
        markRetryNeeded();
        close(); // connection failed, retry on next flush
        return;
    }
    // err == 0, connected
    m_connected = true;
    m_nextConnectAttempt = {};
    m_reconnectDelay = kInitialReconnectDelay;
}

}
