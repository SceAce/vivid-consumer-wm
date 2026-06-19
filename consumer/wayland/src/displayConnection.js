const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

const ProtocolPayloads = imports.protocolPayloads;

var MAX_BODY_BYTES = 65531;
var FRAME_HEADER_BYTES = 4;
var FRAME_READY_BODY_BYTES = 36;
var FRAME_READY_FD_COUNT = 2;
var UNBIND_BODY_BYTES = 12;
var RECONNECT_DELAY_MS = 1000;
var FRAME_SYNC_WAIT_TIMEOUT_MSEC = 1000;

var REQ_HELLO = 1;
var REQ_REGISTER_OUTPUT = 2;
var REQ_CONSUMER_CAPS = 4;
var REQ_BIND_FAILED = 14;
var REQ_UNBIND_DONE = 15;

var EVT_WELCOME = 1;
var EVT_OUTPUT_ACCEPTED = 2;
var EVT_BIND_BUFFERS = 3;
var EVT_SET_CONFIG = 4;
var EVT_FRAME_READY = 5;
var EVT_UNBIND = 6;
var EVT_ERROR = 9;

const OPCODE_BY_EVENT = {
    EVT_WELCOME,
    EVT_OUTPUT_ACCEPTED,
    EVT_BIND_BUFFERS,
    EVT_SET_CONFIG,
    EVT_FRAME_READY,
    EVT_UNBIND,
    EVT_ERROR,
};

const EVENT_BY_OPCODE = {
    [EVT_WELCOME]: 'EVT_WELCOME',
    [EVT_OUTPUT_ACCEPTED]: 'EVT_OUTPUT_ACCEPTED',
    [EVT_BIND_BUFFERS]: 'EVT_BIND_BUFFERS',
    [EVT_SET_CONFIG]: 'EVT_SET_CONFIG',
    [EVT_FRAME_READY]: 'EVT_FRAME_READY',
    [EVT_UNBIND]: 'EVT_UNBIND',
    [EVT_ERROR]: 'EVT_ERROR',
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function readUint16LE(bytes, offset) {
    return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readUint32LE(bytes, offset) {
    return (bytes[offset] ?? 0) |
        ((bytes[offset + 1] ?? 0) << 8) |
        ((bytes[offset + 2] ?? 0) << 16) |
        ((bytes[offset + 3] ?? 0) << 24);
}

function readUint64LE(bytes, offset) {
    const low = readUint32LE(bytes, offset) >>> 0;
    const high = readUint32LE(bytes, offset + 4) >>> 0;
    return high * 0x100000000 + low;
}

function writeUint16LE(bytes, offset, value) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >> 8) & 0xff;
}

function writeUint32LE(bytes, offset, value) {
    bytes[offset] = value & 0xff;
    bytes[offset + 1] = (value >> 8) & 0xff;
    bytes[offset + 2] = (value >> 16) & 0xff;
    bytes[offset + 3] = (value >> 24) & 0xff;
}

function writeUint64LE(bytes, offset, value) {
    const normalized = Math.max(0, Math.floor(Number(value) || 0));
    writeUint32LE(bytes, offset, normalized >>> 0);
    writeUint32LE(bytes, offset + 4, Math.floor(normalized / 0x100000000) >>> 0);
}

function encodeFrame(opcode, body = new Uint8Array(0)) {
    if (body.length > MAX_BODY_BYTES) {
        throw new Error(`frame body too large: ${body.length}`);
    }

    const frame = new Uint8Array(FRAME_HEADER_BYTES + body.length);
    writeUint16LE(frame, 0, opcode);
    writeUint16LE(frame, 2, frame.length);
    frame.set(body, FRAME_HEADER_BYTES);
    return frame;
}

function encodeJsonFrame(opcode, payload = {}) {
    return encodeFrame(opcode, encoder.encode(JSON.stringify(payload)));
}

function decodeJsonPayload(bytes) {
    if (!bytes || bytes.length === 0) {
        return {};
    }

    const text = decoder.decode(bytes);
    if (text.trim() === '') {
        return {};
    }

    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
}

function decodeJsonTextPayload(bytes) {
    const text = !bytes || bytes.length === 0 ? '{}' : decoder.decode(bytes);
    const parsed = text.trim() === '' ? {} : JSON.parse(text);
    return {
        text,
        payload: parsed && typeof parsed === 'object' ? parsed : {},
    };
}

function decodeFrameReadyBody(body) {
    if (body.length !== FRAME_READY_BODY_BYTES) {
        throw new Error(`invalid FRAME_READY body length ${body.length}`);
    }

    return {
        outputId: readUint32LE(body, 0),
        generation: readUint64LE(body, 4),
        bufferIndex: readUint32LE(body, 12),
        sequence: readUint64LE(body, 16),
        targetTimeUsec: readUint64LE(body, 24),
        flags: readUint32LE(body, 32),
    };
}

function decodeUnbindBody(body) {
    if (body.length !== UNBIND_BODY_BYTES) {
        throw new Error(`invalid UNBIND body length ${body.length}`);
    }

    return {
        outputId: readUint32LE(body, 0),
        generation: readUint64LE(body, 4),
    };
}

function frameReadyBodyFromPayload(payload = {}) {
    const body = new Uint8Array(FRAME_READY_BODY_BYTES);
    writeUint32LE(body, 0, Number(payload.outputId ?? 0));
    writeUint64LE(body, 4, Number(payload.generation ?? 0));
    writeUint32LE(body, 12, Number(payload.bufferIndex ?? 0));
    writeUint64LE(body, 16, Number(payload.sequence ?? 0));
    writeUint64LE(body, 24, Number(payload.targetTimeUsec ?? 0));
    writeUint32LE(body, 32, Number(payload.flags ?? 0));
    return body;
}

function unbindBodyFromPayload(payload = {}) {
    const body = new Uint8Array(UNBIND_BODY_BYTES);
    writeUint32LE(body, 0, Number(payload.outputId ?? 0));
    writeUint64LE(body, 4, Number(payload.generation ?? 0));
    return body;
}

function bytesFromGBytes(bytes) {
    const data = bytes.get_data();
    return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function closeDisplayConsumerFd(DisplayConsumer, fd) {
    if (!Number.isFinite(fd) || fd < 0) {
        return;
    }

    try {
        const closeFn = DisplayConsumer?.dmabuf_texture_close_fd;
        if (typeof closeFn === 'function') {
            closeFn(fd);
        }
    } catch (error) {
        printerr(`Vivid Wayland Consumer: fd close failed: ${error}`);
    }
}

function takeFrameFd(fdList, index) {
    try {
        if (!fdList || typeof fdList.get_length !== 'function' ||
            fdList.get_length() <= index) {
            return -1;
        }

        const fd = fdList.get(index);
        return Number.isFinite(fd) ? fd : -1;
    } catch (_error) {
        return -1;
    }
}

function closeFrameFdList(DisplayConsumer, fdList) {
    const length = fdList?.get_length?.() ?? 0;
    for (let index = 0; index < length; index += 1) {
        closeDisplayConsumerFd(DisplayConsumer, takeFrameFd(fdList, index));
    }
}

function signalReleaseSyncobj(DisplayConsumer, generation, releaseFd) {
    if (!Number.isFinite(releaseFd) || releaseFd < 0) {
        return;
    }

    const renderNode = generation?.payload?.['render-node'] ??
        generation?.payload?.renderNode ?? '';
    try {
        const signalFn = DisplayConsumer?.dmabuf_texture_signal_release_syncobj;
        if (typeof signalFn === 'function') {
            signalFn(renderNode, releaseFd);
        }
    } catch (error) {
        printerr(`Vivid Wayland Consumer: release syncobj signal failed: ${error}`);
    }
}

function transformCode(value) {
    if (Number.isFinite(Number(value))) {
        return Number(value);
    }

    switch (String(value ?? 'normal').toLowerCase()) {
    case '90':
    case 'rotate-90':
    case 'rotated-90':
        return 1;
    case '180':
    case 'rotate-180':
    case 'rotated-180':
        return 2;
    case '270':
    case 'rotate-270':
    case 'rotated-270':
        return 3;
    case 'flipped':
    case 'flipped-normal':
        return 4;
    case 'flipped-90':
        return 5;
    case 'flipped-180':
        return 6;
    case 'flipped-270':
        return 7;
    case 'normal':
    default:
        return 0;
    }
}

function numberOrDefault(value, defaultValue) {
    const number = Number(value);
    return Number.isFinite(number) ? number : defaultValue;
}

function payloadForOutput(output, options = {}) {
    if (typeof output.outputPayload === 'function') {
        return output.outputPayload();
    }

    return ProtocolPayloads.buildOutputRegistrationPayload({
        ...output,
        compositor: options.compositor || output.compositor,
    });
}

function createConnectionState(options = {}) {
    return new DisplayConnectionState(options);
}

var DisplayConnectionState = class DisplayConnectionState {
    constructor(options = {}) {
        this._options = {
            pointerEventsEnabled: Boolean(options.pointerEventsEnabled),
            compositor: options.compositor || 'auto',
            renderer: options.renderer,
            dmabufCaps: options.dmabufCaps,
        };
        this._queuedFrames = [];
        this._outputs = [];
        this._outputsByConsumerId = new Map();
        this._outputsByBackendId = new Map();
        this.rebuildTopology(options.outputs || [], {
            connected: false,
            clearExisting: false,
        });
    }

    get outputs() {
        return this._outputs;
    }

    onConnected() {
        this._queue(REQ_HELLO, ProtocolPayloads.buildHelloPayload({
            pointerEventsEnabled: this._options.pointerEventsEnabled,
        }));
        this._queue(REQ_CONSUMER_CAPS, ProtocolPayloads.buildConsumerCapsPayload({
            pointerEventsEnabled: this._options.pointerEventsEnabled,
            renderer: this._options.renderer,
            dmabufCaps: this._options.dmabufCaps,
        }));

        for (const output of this._outputs) {
            this._queue(REQ_REGISTER_OUTPUT, payloadForOutput(output, {
                compositor: this._options.compositor,
            }));
        }
    }

    onSocketClosed() {
        this._clearImportedOutputState();
    }

    rebuildTopology(outputs, options = {}) {
        if (options.clearExisting !== false) {
            this._clearImportedOutputState();
        }

        this._outputs = outputs;
        this._outputsByConsumerId = new Map();
        this._outputsByBackendId = new Map();
        for (const output of outputs) {
            this._outputsByConsumerId.set(Number(output.consumerOutputId ?? output.monitorIndex ?? 0), output);
        }
    }

    dispatchEvent(eventName, payload = {}, fdList = null, rawText = null) {
        switch (eventName) {
        case 'EVT_WELCOME':
            return true;
        case 'EVT_OUTPUT_ACCEPTED':
            return this._handleOutputAccepted(payload);
        case 'EVT_BIND_BUFFERS':
            return this._handleBindBuffers(payload, rawText, fdList);
        case 'EVT_SET_CONFIG':
            return this._handleSetConfig(payload);
        case 'EVT_FRAME_READY':
            return this._handleFrameReady(payload, fdList);
        case 'EVT_UNBIND':
            return this._handleUnbind(payload);
        case 'EVT_ERROR':
            printerr(`Vivid Wayland Consumer: producer error ${JSON.stringify(payload)}`);
            return true;
        default:
            return false;
        }
    }

    handleDecodedFrame(opcode, body, fdList = null) {
        const eventName = EVENT_BY_OPCODE[opcode];
        if (!eventName) {
            return false;
        }

        switch (opcode) {
        case EVT_BIND_BUFFERS: {
            const decoded = decodeJsonTextPayload(body);
            return this.dispatchEvent(eventName, decoded.payload, fdList, decoded.text);
        }
        case EVT_FRAME_READY:
            return this.dispatchEvent(eventName, decodeFrameReadyBody(body), fdList);
        case EVT_UNBIND:
            return this.dispatchEvent(eventName, decodeUnbindBody(body), fdList);
        case EVT_OUTPUT_ACCEPTED:
        case EVT_SET_CONFIG:
        case EVT_ERROR:
        case EVT_WELCOME:
            return this.dispatchEvent(eventName, decodeJsonPayload(body), fdList);
        default:
            return false;
        }
    }

    queueBindFailed(payload) {
        this._queue(REQ_BIND_FAILED, {
            outputId: Number(payload.outputId ?? 0),
            generation: Number(payload.generation ?? 0),
            fourcc: Number(payload.fourcc ?? 0),
            modifier: String(payload.modifier ?? '0'),
            bufferIndex: payload.bufferIndex === null || payload.bufferIndex === undefined
                ? null
                : Number(payload.bufferIndex),
            reason: Number(payload.reason ?? 1),
            message: String(payload.message ?? 'DMA-BUF import failed'),
        });
    }

    takeQueuedFrames() {
        const frames = this._queuedFrames;
        this._queuedFrames = [];
        return frames;
    }

    _queue(opcode, payload) {
        this._queuedFrames.push({
            opcode,
            payload,
            bytes: encodeJsonFrame(opcode, payload),
        });
    }

    _clearImportedOutputState() {
        for (const output of this._outputs) {
            output.clear?.();
            if ('backendOutputId' in output) {
                output.backendOutputId = null;
            }
        }
        this._outputsByBackendId.clear();
    }

    _handleOutputAccepted(payload) {
        const consumerOutputId = Number(payload.consumerOutputId);
        const backendOutputId = Number(payload.outputId);
        const output = this._outputsByConsumerId.get(consumerOutputId);
        if (!output || !Number.isFinite(backendOutputId)) {
            return false;
        }

        output.backendOutputId = backendOutputId;
        this._outputsByBackendId.set(backendOutputId, output);
        return true;
    }

    _outputForBackendId(outputId) {
        return this._outputsByBackendId.get(Number(outputId)) || null;
    }

    _handleBindBuffers(payload, rawText, fdList) {
        const output = this._outputForBackendId(payload.outputId);
        if (!output) {
            return false;
        }

        output.bindBuffers?.(payload, rawText || JSON.stringify(payload), fdList);
        return true;
    }

    _handleSetConfig(payload) {
        const output = this._outputForBackendId(payload.outputId);
        if (!output) {
            return false;
        }

        output.setConfig?.(payload);
        return true;
    }

    _handleFrameReady(frame, fdList) {
        const output = this._outputForBackendId(frame.outputId);
        if (!output) {
            return false;
        }

        output.showFrame?.(frame, fdList);
        return true;
    }

    _handleUnbind(payload) {
        const output = this._outputForBackendId(payload.outputId);
        if (!output) {
            return false;
        }

        output.unbindGeneration?.(payload.generation);
        this._queue(REQ_UNBIND_DONE, {
            outputId: Number(payload.outputId ?? 0),
            generation: Number(payload.generation ?? 0),
        });
        return true;
    }
};

var WaylandOutputPresenter = class WaylandOutputPresenter {
    constructor(surface, outputRegistration, options = {}) {
        this.surface = surface;
        this.registration = outputRegistration;
        this.outputId = outputRegistration.outputId;
        this.consumerOutputId = outputRegistration.consumerOutputId;
        this.monitorIndex = outputRegistration.monitorIndex;
        this.backendOutputId = null;
        this.DisplayConsumer = options.DisplayConsumer;
        this._onBindFailed = null;
        this._bufferGenerations = new Map();
        this._currentGeneration = null;
        this._lastFrameUsec = 0;
        this.paintable = this.DisplayConsumer.BufferPaintable.new();

        if (typeof surface.picture?.set_paintable === 'function') {
            surface.picture.set_paintable(this.paintable);
        } else {
            surface.picture.paintable = this.paintable;
        }
    }

    outputPayload() {
        return this.registration;
    }

    setBindFailedReporter(callback) {
        this._onBindFailed = callback;
    }

    bindBuffers(payload, bindJson, fdList) {
        this.unbindGeneration(payload.generation, {logMissing: false});
        try {
            this.paintable.bind_json(bindJson, fdList);
        } catch (error) {
            this._reportBindFailed(payload, error, 1);
            return;
        }

        this._bufferGenerations.set(Number(payload.generation), {
            payload,
            configured: false,
            configGeneration: 0,
        });
        this._lastFrameUsec = 0;
    }

    setConfig(payload) {
        const source = payload.source ?? {};
        const destination = payload.destination ?? {};
        const clear = Array.isArray(payload.clearColor) ? payload.clearColor : [0, 0, 0, 1];
        const scale = numberOrDefault(this.registration.scale, 1) > 0
            ? numberOrDefault(this.registration.scale, 1)
            : 1;
        const generationId = Number(payload.generation ?? 0);
        let generation = generationId > 0
            ? this._bufferGenerations.get(generationId)
            : this._latestPendingConfigGeneration();
        if (!generation && generationId <= 0) {
            generation = this._latestLiveGeneration();
        }
        if (!generation) {
            return;
        }

        this.paintable.set_config(
            numberOrDefault(source.x, 0),
            numberOrDefault(source.y, 0),
            numberOrDefault(source.width ?? source.w, this.registration.physicalWidth),
            numberOrDefault(source.height ?? source.h, this.registration.physicalHeight),
            numberOrDefault(destination.x, 0) / scale,
            numberOrDefault(destination.y, 0) / scale,
            numberOrDefault(destination.width ?? destination.w, this.registration.physicalWidth) / scale,
            numberOrDefault(destination.height ?? destination.h, this.registration.physicalHeight) / scale,
            transformCode(payload.transform),
            numberOrDefault(clear[0], 0),
            numberOrDefault(clear[1], 0),
            numberOrDefault(clear[2], 0),
            numberOrDefault(clear[3], 1),
        );
        generation.configured = true;
        generation.configGeneration = Number(payload.configGeneration ?? generation.configGeneration ?? 0);
    }

    showFrame(frame, fdList) {
        const fdCount = fdList?.get_length?.() ?? 0;
        if (fdCount !== FRAME_READY_FD_COUNT) {
            closeFrameFdList(this.DisplayConsumer, fdList);
            return;
        }

        let acquireFd = takeFrameFd(fdList, 0);
        let releaseFd = takeFrameFd(fdList, 1);
        const generation = this._bufferGenerations.get(Number(frame.generation));
        if (!generation) {
            closeDisplayConsumerFd(this.DisplayConsumer, acquireFd);
            closeDisplayConsumerFd(this.DisplayConsumer, releaseFd);
            return;
        }
        if (acquireFd < 0 || releaseFd < 0) {
            closeDisplayConsumerFd(this.DisplayConsumer, acquireFd);
            signalReleaseSyncobj(this.DisplayConsumer, generation, releaseFd);
            closeDisplayConsumerFd(this.DisplayConsumer, releaseFd);
            return;
        }
        if (!generation.configured) {
            closeDisplayConsumerFd(this.DisplayConsumer, acquireFd);
            signalReleaseSyncobj(this.DisplayConsumer, generation, releaseFd);
            closeDisplayConsumerFd(this.DisplayConsumer, releaseFd);
            return;
        }

        try {
            this.paintable.flush_pending_release_syncobj('wayland-frame-ready');
            if (generation.payload?.presentationPath === 'shadow-copy' &&
                typeof this.paintable.show_frame_with_sync === 'function') {
                const displayConsumerAcquireFd = acquireFd;
                const displayConsumerReleaseFd = releaseFd;
                acquireFd = -1;
                releaseFd = -1;
                this.paintable.show_frame_with_sync(
                    frame.generation,
                    frame.bufferIndex,
                    displayConsumerAcquireFd,
                    displayConsumerReleaseFd,
                );
            } else {
                const waitFn = this.DisplayConsumer?.dmabuf_texture_wait_sync_file;
                if (typeof waitFn === 'function' &&
                    waitFn(acquireFd, FRAME_SYNC_WAIT_TIMEOUT_MSEC) !== true) {
                    closeDisplayConsumerFd(this.DisplayConsumer, acquireFd);
                    signalReleaseSyncobj(this.DisplayConsumer, generation, releaseFd);
                    closeDisplayConsumerFd(this.DisplayConsumer, releaseFd);
                    acquireFd = -1;
                    releaseFd = -1;
                    return;
                }
                closeDisplayConsumerFd(this.DisplayConsumer, acquireFd);
                acquireFd = -1;
                this.paintable.show_frame(frame.generation, frame.bufferIndex);
                this.paintable.attach_release_syncobj(frame.generation, frame.bufferIndex, releaseFd);
                releaseFd = -1;
            }
            this._currentGeneration = Number(frame.generation);
            this._lastFrameUsec = GLib.get_monotonic_time();
        } catch (error) {
            signalReleaseSyncobj(this.DisplayConsumer, generation, releaseFd);
            this._reportBindFailed(generation.payload, error, 2, frame.bufferIndex);
            this.unbindGeneration(frame.generation, {logMissing: false, logSuccess: false});
        } finally {
            closeDisplayConsumerFd(this.DisplayConsumer, acquireFd);
            closeDisplayConsumerFd(this.DisplayConsumer, releaseFd);
        }
    }

    unbindGeneration(generationId, options = {}) {
        const generation = this._bufferGenerations.get(Number(generationId));
        if (!generation) {
            if (options.logMissing) {
                printerr(`Vivid Wayland Consumer: missing generation ${generationId}`);
            }
            return;
        }

        try {
            this.paintable.unbind(generationId);
        } catch (error) {
            printerr(`Vivid Wayland Consumer: paintable unbind failed: ${error}`);
        }
        if (this._currentGeneration === Number(generationId)) {
            this._currentGeneration = null;
        }
        this._bufferGenerations.delete(Number(generationId));
    }

    clear() {
        for (const generationId of [...this._bufferGenerations.keys()]) {
            this.unbindGeneration(generationId);
        }
        this.paintable.clear();
        this.backendOutputId = null;
        this._currentGeneration = null;
        this._lastFrameUsec = 0;
    }

    _latestPendingConfigGeneration() {
        const generations = [...this._bufferGenerations.entries()]
            .sort(([left], [right]) => Number(right) - Number(left));
        for (const [, generation] of generations) {
            if (!generation.configured) {
                return generation;
            }
        }
        return null;
    }

    _latestLiveGeneration() {
        const generations = [...this._bufferGenerations.entries()]
            .sort(([left], [right]) => Number(right) - Number(left));
        return generations.length > 0 ? generations[0][1] : null;
    }

    _reportBindFailed(payload, message, reason = 1, bufferIndex = null) {
        if (!payload || !this._onBindFailed) {
            return;
        }

        this._onBindFailed({
            outputId: Number(payload.outputId ?? this.backendOutputId ?? 0),
            generation: Number(payload.generation ?? 0),
            fourcc: Number(payload.fourcc ?? 0),
            modifier: payload.modifier ?? '0',
            bufferIndex: bufferIndex ?? payload.bufferIndex ?? payload.buffer ?? null,
            reason,
            message: String(message ?? 'DMA-BUF import failed'),
        });
    }
};

var DisplaySocketClient = class DisplaySocketClient {
    constructor(options = {}) {
        this._socketPath = options.socketPath;
        this._DisplayConsumer = options.DisplayConsumer;
        this._state = options.state || createConnectionState(options);
        this._connection = null;
        this._output = null;
        this._socketClient = null;
        this._receiver = null;
        this._receiverSignalIds = [];
        this._writeQueue = [];
        this._writePending = false;
        this._reconnectSourceId = 0;
        this._cancellable = new Gio.Cancellable();
        this._log = options.log || (message => printerr(`Vivid Wayland Consumer: ${message}`));

        for (const output of this._state.outputs) {
            output.setBindFailedReporter?.(payload => {
                this._state.queueBindFailed(payload);
                this._drainStateQueue();
            });
        }
    }

    start() {
        this._connect();
    }

    stop() {
        this._clearReconnect();
        try {
            this._cancellable.cancel();
        } catch (_error) {
        }
        this._closeConnection(false);
    }

    rebuildTopology(outputs) {
        const wasConnected = this._connection !== null;
        if (wasConnected) {
            this._closeConnection(false);
        }

        this._state.rebuildTopology(outputs, {
            clearExisting: !wasConnected,
        });
        for (const output of outputs) {
            output.setBindFailedReporter?.(payload => {
                this._state.queueBindFailed(payload);
                this._drainStateQueue();
            });
        }
        if (wasConnected) {
            this._scheduleReconnect();
        }
    }

    _connect() {
        this._clearReconnect();
        this._socketClient = new Gio.SocketClient();
        this._socketClient.connect_async(
            Gio.UnixSocketAddress.new(this._socketPath),
            this._cancellable,
            (client, result) => {
                try {
                    this._connection = client.connect_finish(result);
                    this._output = this._connection.get_output_stream();
                    this._startReceiver();
                    this._state.onConnected();
                    this._drainStateQueue();
                    this._log(`connected to ${this._socketPath}`);
                } catch (error) {
                    if (!error.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        this._log(`connect failed at ${this._socketPath}: ${error}`);
                        this._scheduleReconnect();
                    }
                }
            },
        );
    }

    _startReceiver() {
        this._receiver = this._DisplayConsumer.Receiver.new(this._connection);
        this._receiverSignalIds = [
            this._receiver.connect('frame', (_receiver, opcode, body, fdList) => {
                try {
                    const handled = this._state.handleDecodedFrame(opcode, bytesFromGBytes(body), fdList);
                    if (!handled && (opcode === EVT_FRAME_READY || opcode === EVT_BIND_BUFFERS)) {
                        closeFrameFdList(this._DisplayConsumer, fdList);
                    }
                    this._drainStateQueue();
                } catch (error) {
                    this._log(`failed to handle frame opcode=${opcode}: ${error}`);
                    if (opcode === EVT_FRAME_READY || opcode === EVT_BIND_BUFFERS) {
                        closeFrameFdList(this._DisplayConsumer, fdList);
                    }
                }
            }),
            this._receiver.connect('protocol-error', (_receiver, code, message) => {
                this._log(`protocol error ${code}: ${message}`);
                this._closeConnection(true);
            }),
            this._receiver.connect('closed', () => {
                this._log('socket closed by producer');
                this._closeConnection(true);
            }),
        ];

        if (!this._receiver.start()) {
            throw new Error('display consumer receiver failed to start');
        }
    }

    _drainStateQueue() {
        for (const frame of this._state.takeQueuedFrames()) {
            this._writeQueue.push(frame.bytes);
        }
        this._flushWriteQueue();
    }

    _flushWriteQueue() {
        if (!this._output || this._writePending || this._writeQueue.length === 0) {
            return;
        }

        const bytes = this._writeQueue[0];
        this._writePending = true;
        this._output.write_all_async(bytes, GLib.PRIORITY_DEFAULT, this._cancellable, (stream, result) => {
            if (stream !== this._output) {
                return;
            }

            try {
                stream.write_all_finish(result);
                this._writeQueue.shift();
            } catch (error) {
                this._log(`socket write failed: ${error}`);
                this._closeConnection(true);
                return;
            }

            this._writePending = false;
            this._flushWriteQueue();
        });
    }

    _closeConnection(reconnect) {
        if (this._receiver) {
            for (const id of this._receiverSignalIds) {
                try {
                    this._receiver.disconnect(id);
                } catch (_error) {
                }
            }
            this._receiverSignalIds = [];
            try {
                this._receiver.stop();
            } catch (_error) {
            }
            this._receiver = null;
        }

        this._state.onSocketClosed();

        try {
            this._connection?.close(null);
        } catch (_error) {
        }
        this._connection = null;
        this._output = null;
        this._socketClient = null;
        this._writeQueue = [];
        this._writePending = false;

        if (reconnect) {
            this._scheduleReconnect();
        }
    }

    _scheduleReconnect() {
        if (this._reconnectSourceId) {
            return;
        }

        this._reconnectSourceId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, RECONNECT_DELAY_MS, () => {
            this._reconnectSourceId = 0;
            this._connect();
            return GLib.SOURCE_REMOVE;
        });
    }

    _clearReconnect() {
        if (!this._reconnectSourceId) {
            return;
        }

        GLib.source_remove(this._reconnectSourceId);
        this._reconnectSourceId = 0;
    }
};

var DisplayConnection = {
    REQ_HELLO,
    REQ_REGISTER_OUTPUT,
    REQ_CONSUMER_CAPS,
    REQ_BIND_FAILED,
    REQ_UNBIND_DONE,
    EVT_WELCOME,
    EVT_OUTPUT_ACCEPTED,
    EVT_BIND_BUFFERS,
    EVT_SET_CONFIG,
    EVT_FRAME_READY,
    EVT_UNBIND,
    EVT_ERROR,
    OPCODE_BY_EVENT,
    EVENT_BY_OPCODE,
    createConnectionState,
    encodeFrame,
    encodeJsonFrame,
    decodeJsonPayload,
    decodeFrameReadyBody,
    decodeUnbindBody,
    frameReadyBodyFromPayload,
    unbindBodyFromPayload,
    WaylandOutputPresenter,
    DisplaySocketClient,
};
