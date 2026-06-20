const DisplayConnection = imports.displayConnection;
const GLib = imports.gi.GLib;

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
    }
}

function assertDeepEqual(actual, expected, message) {
    const actualJson = JSON.stringify(actual);
    const expectedJson = JSON.stringify(expected);
    if (actualJson !== expectedJson) {
        throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`);
    }
}

function assertIncludes(values, expected, message) {
    if (!values.includes(expected)) {
        throw new Error(`${message}: expected ${JSON.stringify(values)} to include ${expected}`);
    }
}

function readUint16LE(bytes, offset) {
    return bytes[offset] | (bytes[offset + 1] << 8);
}

function readUint32LE(bytes, offset) {
    return (bytes[offset] |
        (bytes[offset + 1] << 8) |
        (bytes[offset + 2] << 16) |
        (bytes[offset + 3] << 24)) >>> 0;
}

function readUint64LE(bytes, offset) {
    return readUint32LE(bytes, offset) + readUint32LE(bytes, offset + 4) * 0x100000000;
}

function readFloat64LE(bytes, offset) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return view.getFloat64(offset, true);
}

function makeOutput(outputId, consumerOutputId = 0) {
    const calls = [];
    return {
        outputId,
        consumerOutputId,
        monitorIndex: consumerOutputId,
        scale: 1,
        calls,
        backendOutputId: null,
        clear() {
            calls.push(['clear']);
            this.backendOutputId = null;
        },
        bindBuffers(payload, bindJson, fdList) {
            calls.push(['bindBuffers', payload, bindJson, fdList]);
        },
        setConfig(payload) {
            calls.push(['setConfig', payload]);
        },
        showFrame(frame, fdList) {
            calls.push(['showFrame', frame, fdList]);
        },
        unbindGeneration(generation) {
            calls.push(['unbindGeneration', generation]);
        },
    };
}

function makeDisplayConsumerFake(options = {}) {
    const calls = [];
    return {
        calls,
        BufferPaintable: {
            new() {
                return {
                    bind_json(bindJson, fdList) {
                        calls.push(['bind_json', bindJson, fdList]);
                    },
                    set_config(...args) {
                        calls.push(['set_config', ...args]);
                    },
                    flush_pending_release_syncobj(reason) {
                        calls.push(['flush_pending_release_syncobj', reason]);
                    },
                    show_frame(generation, bufferIndex) {
                        calls.push(['show_frame', generation, bufferIndex]);
                        if (options.showFrameThrows) {
                            throw new Error('show frame failed');
                        }
                    },
                    show_frame_with_sync(generation, bufferIndex, acquireFd, releaseFd) {
                        calls.push(['show_frame_with_sync', generation, bufferIndex, acquireFd, releaseFd]);
                    },
                    attach_release_syncobj(generation, bufferIndex, releaseFd) {
                        calls.push(['attach_release_syncobj', generation, bufferIndex, releaseFd]);
                    },
                    unbind(generation) {
                        calls.push(['unbind', generation]);
                    },
                    clear() {
                        calls.push(['clear']);
                    },
                };
            },
        },
        dmabuf_texture_wait_sync_file(fd, timeoutMsec) {
            calls.push(['wait_sync_file', fd, timeoutMsec]);
            return options.acquireWaitOk !== false;
        },
        dmabuf_texture_signal_release_syncobj(renderNode, fd) {
            calls.push(['signal_release_syncobj', renderNode, fd]);
            return true;
        },
        dmabuf_texture_close_fd(fd) {
            calls.push(['close_fd', fd]);
        },
    };
}

function makeFdList(fds) {
    return {
        get_length() {
            return fds.length;
        },
        get(index) {
            return fds[index];
        },
    };
}

function makeOwnedFdList(ownedFds, duplicateFds = []) {
    const state = {
        ownedFds: ownedFds.slice(),
        duplicateFds: duplicateFds.slice(),
        getCalls: [],
        stealCalls: 0,
    };
    return {
        state,
        get_length() {
            return state.ownedFds.length;
        },
        get(index) {
            state.getCalls.push(index);
            return state.duplicateFds[index] ?? -1;
        },
        steal_fds() {
            state.stealCalls += 1;
            const stolen = state.ownedFds;
            state.ownedFds = [];
            return stolen;
        },
    };
}

function makeGBytesFake(bytes) {
    return {
        get_data() {
            return bytes;
        },
    };
}

function makeOutputMapWriterFake() {
    const calls = [];
    return {
        calls,
        write(outputs) {
            calls.push(outputs.map(output => ({
                monitorName: output.monitorName,
                outputId: output.outputId,
            })));
        },
    };
}

function queuedTypes(state) {
    return state.takeQueuedFrames().map(frame => frame.payload.type);
}

function makeStartedClient(state, DisplayConsumer) {
    const client = new DisplayConnection.DisplaySocketClient({
        socketPath: '/tmp/vivid-test.sock',
        state,
        DisplayConsumer,
        log() {},
    });
    client._connection = {};
    client._startReceiver();
    return client;
}

function testStartupQueuesHelloCapsThenOutputRegistration() {
    const output = makeOutput('DP-1', 7);
    const state = DisplayConnection.createConnectionState({
        outputs: [output],
        pointerEventsEnabled: true,
        dmabufCaps: {version: 3, probe: 'test'},
    });

    state.onConnected();

    assertDeepEqual(queuedTypes(state), [
        'REQ_HELLO',
        'REQ_CONSUMER_CAPS',
        'REQ_REGISTER_OUTPUT',
    ], 'startup message order');
}

function testSocketCloseClearsImportedOutputState() {
    const output = makeOutput('DP-1', 0);
    const outputMapWriter = makeOutputMapWriterFake();
    const state = DisplayConnection.createConnectionState({
        outputs: [output],
        outputMapWriter,
    });
    state.onConnected();
    state.dispatchEvent('EVT_OUTPUT_ACCEPTED', {
        consumerOutputId: 0,
        outputId: 44,
    });

    state.onSocketClosed();

    assertEqual(output.backendOutputId, null, 'backend output id cleared');
    assertDeepEqual(output.calls, [['clear']], 'output clear call');
    assertDeepEqual(outputMapWriter.calls, [
        [{monitorName: 'DP-1', outputId: 44}],
        [],
    ], 'socket close clears output map');
}

function testReconnectResendsHelloCapsAndOutputs() {
    const output = makeOutput('HDMI-A-1', 1);
    const state = DisplayConnection.createConnectionState({outputs: [output]});

    state.onConnected();
    queuedTypes(state);
    state.onSocketClosed();
    state.onConnected();

    assertDeepEqual(queuedTypes(state), [
        'REQ_HELLO',
        'REQ_CONSUMER_CAPS',
        'REQ_REGISTER_OUTPUT',
    ], 'reconnect message order');
}

function testTopologyRebuildClearsOutputsBeforeReconnect() {
    const oldOutput = makeOutput('DP-1', 0);
    const newOutput = makeOutput('DP-2', 1);
    const state = DisplayConnection.createConnectionState({outputs: [oldOutput]});
    state.onConnected();
    queuedTypes(state);

    state.rebuildTopology([newOutput]);
    state.onConnected();

    assertDeepEqual(oldOutput.calls, [['clear']], 'old output cleared during topology rebuild');
    const queued = state.takeQueuedFrames().map(frame => frame.payload);
    assertDeepEqual(queued.map(payload => payload.type), [
        'REQ_HELLO',
        'REQ_CONSUMER_CAPS',
        'REQ_REGISTER_OUTPUT',
    ], 'topology reconnect message order');
    assertEqual(queued[2].outputId, 'DP-2', 'new output registered after topology rebuild');
}

function testConnectedRuntimeTopologyRebuildReconnectsBeforeReplayingHandshake() {
    const oldOutput = makeOutput('DP-1', 0);
    const newOutput = makeOutput('DP-2', 1);
    const state = DisplayConnection.createConnectionState({outputs: [oldOutput]});
    const client = new DisplayConnection.DisplaySocketClient({
        socketPath: '/tmp/vivid-test.sock',
        state,
        DisplayConsumer: {Receiver: {new() { throw new Error('unused'); }}},
        log() {},
    });
    let closeCalls = 0;
    let reconnectCalls = 0;
    const writes = [];
    client._connection = {
        close() {
            closeCalls += 1;
        },
    };
    client._output = {
        write_all_async(bytes) {
            writes.push(bytes);
        },
    };
    client._scheduleReconnect = () => {
        reconnectCalls += 1;
    };
    state.onConnected();
    state.takeQueuedFrames();

    client.rebuildTopology([newOutput]);

    assertEqual(closeCalls, 1, 'connected topology rebuild closes current socket');
    assertEqual(reconnectCalls, 1, 'connected topology rebuild schedules reconnect');
    assertDeepEqual(oldOutput.calls, [['clear']], 'connected topology rebuild clears old output');
    assertEqual(writes.length, 0, 'connected topology rebuild does not write handshake to old socket');
    assertDeepEqual(state.takeQueuedFrames().map(frame => frame.payload.type), [], 'connected topology rebuild does not replay hello on old socket');
}

function testProducerEventsDispatchToOutputImportPath() {
    const output = makeOutput('DP-1', 0);
    const bindFdList = {id: 'bind-fds'};
    const frameFdList = {id: 'frame-fds'};
    const state = DisplayConnection.createConnectionState({outputs: [output]});
    state.onConnected();
    state.dispatchEvent('EVT_OUTPUT_ACCEPTED', {
        consumerOutputId: 0,
        outputId: 17,
    });

    state.dispatchEvent('EVT_BIND_BUFFERS', {
        outputId: 17,
        generation: 5,
    }, bindFdList, '{"outputId":17,"generation":5}');
    state.dispatchEvent('EVT_SET_CONFIG', {
        outputId: 17,
        generation: 5,
    });
    state.dispatchEvent('EVT_FRAME_READY', {
        outputId: 17,
        generation: 5,
        bufferIndex: 1,
    }, frameFdList);
    state.dispatchEvent('EVT_UNBIND', {
        outputId: 17,
        generation: 5,
    });

    assertEqual(output.backendOutputId, 17, 'accepted backend output id');
    assertDeepEqual(output.calls, [
        ['bindBuffers', {outputId: 17, generation: 5}, '{"outputId":17,"generation":5}', bindFdList],
        ['setConfig', {outputId: 17, generation: 5}],
        ['showFrame', {outputId: 17, generation: 5, bufferIndex: 1}, frameFdList],
        ['unbindGeneration', 5],
    ], 'event dispatch order');
}

function testClientReleasesBindBuffersOwnedFdListAfterSuccessfulHandling() {
    let frameCallback = null;
    const closedFds = [];
    const DisplayConsumer = {
        Receiver: {
            new() {
                return {
                    connect(signal, callback) {
                        if (signal === 'frame') {
                            frameCallback = callback;
                        }
                        return 1;
                    },
                    start() {
                        return true;
                    },
                };
            },
        },
        dmabuf_texture_close_fd(fd) {
            closedFds.push(fd);
        },
    };
    const output = makeOutput('DP-1', 0);
    const state = DisplayConnection.createConnectionState({
        outputs: [output],
        outputMapWriter: makeOutputMapWriterFake(),
    });
    state.dispatchEvent('EVT_OUTPUT_ACCEPTED', {
        consumerOutputId: 0,
        outputId: 17,
    });
    makeStartedClient(state, DisplayConsumer);
    const fdList = makeOwnedFdList([700, 701], [1700, 1701]);
    const body = new TextEncoder().encode('{"outputId":17,"generation":5}');

    frameCallback(null, DisplayConnection.EVT_BIND_BUFFERS, makeGBytesFake(body), fdList);

    assertDeepEqual(output.calls, [
        ['bindBuffers', {outputId: 17, generation: 5}, '{"outputId":17,"generation":5}', fdList],
    ], 'bind buffers dispatched before fd-list release');
    assertDeepEqual(closedFds, [700, 701], 'bind buffers owned fds released');
    assertEqual(fdList.get_length(), 0, 'bind buffers fd list drained');
    assertEqual(fdList.state.stealCalls, 1, 'bind buffers fd list stolen once');
    assertDeepEqual(fdList.state.getCalls, [], 'bind buffers success does not close get duplicates');
}

function testClientReleasesFrameReadyOwnedFdListAfterSuccessfulHandling() {
    let frameCallback = null;
    const closedFds = [];
    const DisplayConsumer = {
        Receiver: {
            new() {
                return {
                    connect(signal, callback) {
                        if (signal === 'frame') {
                            frameCallback = callback;
                        }
                        return 1;
                    },
                    start() {
                        return true;
                    },
                };
            },
        },
        dmabuf_texture_close_fd(fd) {
            closedFds.push(fd);
        },
    };
    const output = makeOutput('DP-1', 0);
    const state = DisplayConnection.createConnectionState({
        outputs: [output],
        outputMapWriter: makeOutputMapWriterFake(),
    });
    state.dispatchEvent('EVT_OUTPUT_ACCEPTED', {
        consumerOutputId: 0,
        outputId: 17,
    });
    makeStartedClient(state, DisplayConsumer);
    const fdList = makeOwnedFdList([800, 801], [1800, 1801]);

    frameCallback(null, DisplayConnection.EVT_FRAME_READY, makeGBytesFake(
        DisplayConnection.frameReadyBodyFromPayload({
            outputId: 17,
            generation: 5,
            bufferIndex: 1,
        }),
    ), fdList);

    assertDeepEqual(output.calls, [
        ['showFrame', {outputId: 17, generation: 5, bufferIndex: 1, sequence: 0, targetTimeUsec: 0, flags: 0}, fdList],
    ], 'frame ready dispatched before fd-list release');
    assertDeepEqual(closedFds, [800, 801], 'frame ready owned fds released');
    assertEqual(fdList.get_length(), 0, 'frame ready fd list drained');
    assertEqual(fdList.state.stealCalls, 1, 'frame ready fd list stolen once');
    assertDeepEqual(fdList.state.getCalls, [], 'frame ready success does not close get duplicates');
}

function testClientReleasesBindBuffersOwnedFdListAfterUnknownOutput() {
    let frameCallback = null;
    const closedFds = [];
    const DisplayConsumer = {
        Receiver: {
            new() {
                return {
                    connect(signal, callback) {
                        if (signal === 'frame') {
                            frameCallback = callback;
                        }
                        return 1;
                    },
                    start() {
                        return true;
                    },
                };
            },
        },
        dmabuf_texture_close_fd(fd) {
            closedFds.push(fd);
        },
    };
    const state = DisplayConnection.createConnectionState({
        outputs: [makeOutput('DP-1', 0)],
        outputMapWriter: makeOutputMapWriterFake(),
    });
    makeStartedClient(state, DisplayConsumer);
    const fdList = makeOwnedFdList([900, 901], [1900, 1901]);
    const body = new TextEncoder().encode('{"outputId":99,"generation":5}');

    frameCallback(null, DisplayConnection.EVT_BIND_BUFFERS, makeGBytesFake(body), fdList);

    assertDeepEqual(closedFds, [1900, 1901, 900, 901], 'unknown bind closes duplicate and owned fds');
    assertEqual(fdList.get_length(), 0, 'unknown bind fd list drained');
    assertEqual(fdList.state.stealCalls, 1, 'unknown bind fd list stolen once');
    assertDeepEqual(fdList.state.getCalls, [0, 1], 'unknown bind closes get duplicates');
}

function testClientReleasesFrameReadyOwnedFdListAfterHandlerException() {
    let frameCallback = null;
    const closedFds = [];
    const DisplayConsumer = {
        Receiver: {
            new() {
                return {
                    connect(signal, callback) {
                        if (signal === 'frame') {
                            frameCallback = callback;
                        }
                        return 1;
                    },
                    start() {
                        return true;
                    },
                };
            },
        },
        dmabuf_texture_close_fd(fd) {
            closedFds.push(fd);
        },
    };
    const state = {
        outputs: [],
        handleDecodedFrame() {
            throw new Error('frame handler failed');
        },
        takeQueuedFrames() {
            return [];
        },
    };
    makeStartedClient(state, DisplayConsumer);
    const fdList = makeOwnedFdList([1000, 1001], [2000, 2001]);

    frameCallback(null, DisplayConnection.EVT_FRAME_READY, makeGBytesFake(
        DisplayConnection.frameReadyBodyFromPayload({
            outputId: 17,
            generation: 5,
            bufferIndex: 1,
        }),
    ), fdList);

    assertDeepEqual(closedFds, [2000, 2001, 1000, 1001], 'exception closes duplicate and owned fds');
    assertEqual(fdList.get_length(), 0, 'exception fd list drained');
    assertEqual(fdList.state.stealCalls, 1, 'exception fd list stolen once');
    assertDeepEqual(fdList.state.getCalls, [0, 1], 'exception closes get duplicates');
}

function testAcceptedOutputsUpdateHyprlandPluginOutputMap() {
    const firstOutput = makeOutput('DP-1', 0);
    const secondOutput = makeOutput('HDMI-A-1', 1);
    const outputMapWriter = makeOutputMapWriterFake();
    const state = DisplayConnection.createConnectionState({
        outputs: [firstOutput, secondOutput],
        outputMapWriter,
    });

    state.dispatchEvent('EVT_OUTPUT_ACCEPTED', {
        consumerOutputId: 0,
        outputId: 17,
    });
    state.dispatchEvent('EVT_OUTPUT_ACCEPTED', {
        consumerOutputId: 1,
        outputId: 22,
    });

    assertDeepEqual(outputMapWriter.calls, [
        [{monitorName: 'DP-1', outputId: 17}],
        [
            {monitorName: 'DP-1', outputId: 17},
            {monitorName: 'HDMI-A-1', outputId: 22},
        ],
    ], 'accepted output map writes');

    state.rebuildTopology([]);
    assertDeepEqual(outputMapWriter.calls[2], [], 'topology rebuild clears output map');
}

function testOutputMapFileWriterWritesDocumentedJsonShape() {
    const path = `/tmp/vivid-output-map-writer-${GLib.get_monotonic_time()}/outputs.json`;
    const writer = new DisplayConnection.OutputMapFileWriter({
        path,
        log() {},
    });

    writer.write([
        {monitorName: 'DP-1', outputId: 17},
        {monitorName: 'HDMI-A-1', outputId: 22},
    ]);

    const [ok, contents] = GLib.file_get_contents(path);
    assertEqual(ok, true, 'output map file readable');
    assertDeepEqual(JSON.parse(new TextDecoder().decode(contents)), {
        version: 1,
        outputs: [
            {monitorName: 'DP-1', outputId: 17},
            {monitorName: 'HDMI-A-1', outputId: 22},
        ],
    }, 'output map json payload');
}

function testPointerMotionQueuesScaledBinaryFrameForAcceptedOutput() {
    const output = makeOutput('DP-1', 0);
    output.scale = 1.5;
    const state = DisplayConnection.createConnectionState({
        outputs: [output],
        pointerEventsEnabled: true,
    });
    state.dispatchEvent('EVT_OUTPUT_ACCEPTED', {
        consumerOutputId: 0,
        outputId: 17,
    });

    const queued = state.queuePointerMotion(output, 10, 20, 123456789);

    assertEqual(queued, true, 'pointer motion queued');
    const frames = state.takeQueuedFrames();
    assertEqual(frames.length, 1, 'pointer motion frame count');
    assertEqual(frames[0].opcode, DisplayConnection.REQ_POINTER_MOTION, 'pointer motion opcode');
    assertEqual(readUint16LE(frames[0].bytes, 0), 7, 'encoded pointer motion opcode');
    assertEqual(readUint16LE(frames[0].bytes, 2), 32, 'encoded pointer motion frame length');
    assertEqual(readUint32LE(frames[0].bytes, 4), 17, 'pointer motion backend output id');
    assertEqual(readFloat64LE(frames[0].bytes, 8), 15, 'pointer motion scaled x');
    assertEqual(readFloat64LE(frames[0].bytes, 16), 30, 'pointer motion scaled y');
    assertEqual(readUint64LE(frames[0].bytes, 24), 123456789, 'pointer motion time usec');
}

function testPointerMotionIgnoresOutputWithoutBackendId() {
    const output = makeOutput('DP-1', 0);
    const state = DisplayConnection.createConnectionState({
        outputs: [output],
        pointerEventsEnabled: true,
    });

    const queued = state.queuePointerMotion(output, 10, 20, 123456789);

    assertEqual(queued, false, 'pointer motion ignored without backend id');
    assertDeepEqual(state.takeQueuedFrames(), [], 'no queued pointer motion frames');
}

function testClientQueuesPointerMotionThroughState() {
    const output = makeOutput('DP-1', 0);
    const state = DisplayConnection.createConnectionState({
        outputs: [output],
        pointerEventsEnabled: true,
    });
    const client = new DisplayConnection.DisplaySocketClient({
        socketPath: '/tmp/vivid-test.sock',
        state,
        DisplayConsumer: {Receiver: {new() { throw new Error('unused'); }}},
        log() {},
    });
    const writes = [];
    client._output = {
        write_all_async(bytes) {
            writes.push(bytes);
        },
    };
    state.dispatchEvent('EVT_OUTPUT_ACCEPTED', {
        consumerOutputId: 0,
        outputId: 17,
    });

    const queued = client.queuePointerMotion(output, 10, 20, 123456789);

    assertEqual(queued, true, 'client pointer motion queued');
    assertEqual(writes.length, 1, 'client wrote pointer motion frame');
    assertEqual(readUint16LE(writes[0], 0), 7, 'client pointer motion opcode');
}

function testClientCoalescesOnlyPendingPointerMotionFrames() {
    const output = makeOutput('DP-1', 0);
    const state = DisplayConnection.createConnectionState({
        outputs: [output],
        pointerEventsEnabled: true,
    });
    const client = new DisplayConnection.DisplaySocketClient({
        socketPath: '/tmp/vivid-test.sock',
        state,
        DisplayConsumer: {Receiver: {new() { throw new Error('unused'); }}},
        log() {},
    });
    let pendingCallback = null;
    const writes = [];
    client._output = {
        write_all_async(bytes, priority, cancellable, callback) {
            writes.push(bytes);
            pendingCallback = callback;
        },
        write_all_finish() {},
    };
    state.dispatchEvent('EVT_OUTPUT_ACCEPTED', {
        consumerOutputId: 0,
        outputId: 17,
    });

    client.queuePointerMotion(output, 1, 1, 100);
    client.queuePointerMotion(output, 2, 2, 200);
    client.queuePointerMotion(output, 3, 3, 300);
    pendingCallback(client._output, {});

    assertEqual(writes.length, 2, 'in-flight plus coalesced pending write count');
    assertEqual(readFloat64LE(writes[0], 8), 1, 'in-flight pointer x is preserved');
    assertEqual(readFloat64LE(writes[1], 8), 3, 'pending pointer x is coalesced to latest');
    assertEqual(readUint64LE(writes[1], 24), 300, 'pending pointer time is coalesced to latest');
}

function testClientCoalescesPointerMotionPerBackendOutput() {
    const firstOutput = makeOutput('DP-1', 0);
    const secondOutput = makeOutput('HDMI-A-1', 1);
    const state = DisplayConnection.createConnectionState({
        outputs: [firstOutput, secondOutput],
        pointerEventsEnabled: true,
    });
    const client = new DisplayConnection.DisplaySocketClient({
        socketPath: '/tmp/vivid-test.sock',
        state,
        DisplayConsumer: {Receiver: {new() { throw new Error('unused'); }}},
        log() {},
    });
    let pendingCallback = null;
    const writes = [];
    client._output = {
        write_all_async(bytes, priority, cancellable, callback) {
            writes.push(bytes);
            pendingCallback = callback;
        },
        write_all_finish() {},
    };
    state.dispatchEvent('EVT_OUTPUT_ACCEPTED', {
        consumerOutputId: 0,
        outputId: 17,
    });
    state.dispatchEvent('EVT_OUTPUT_ACCEPTED', {
        consumerOutputId: 1,
        outputId: 22,
    });

    client.queuePointerMotion(firstOutput, 1, 1, 100);
    client.queuePointerMotion(firstOutput, 2, 2, 200);
    client.queuePointerMotion(secondOutput, 5, 5, 500);
    client.queuePointerMotion(firstOutput, 3, 3, 300);
    pendingCallback(client._output, {});
    pendingCallback(client._output, {});

    assertEqual(writes.length, 3, 'in-flight plus one pending frame per output');
    assertEqual(readUint32LE(writes[0], 4), 17, 'in-flight backend output id');
    assertEqual(readUint32LE(writes[1], 4), 17, 'coalesced first backend output id');
    assertEqual(readFloat64LE(writes[1], 8), 3, 'coalesced first backend x');
    assertEqual(readUint32LE(writes[2], 4), 22, 'second backend output id');
    assertEqual(readFloat64LE(writes[2], 8), 5, 'second backend x');
}

function testRejectedFrameSignalsReleaseSyncobjBeforeCloseWhenConfigIsPending() {
    const DisplayConsumer = makeDisplayConsumerFake();
    const presenter = new DisplayConnection.WaylandOutputPresenter({
        picture: {
            set_paintable() {},
        },
    }, {
        outputId: 'DP-1',
        consumerOutputId: 0,
        monitorIndex: 0,
        scale: 1,
        physicalWidth: 1920,
        physicalHeight: 1080,
    }, {
        DisplayConsumer,
    });

    presenter.bindBuffers({
        outputId: 17,
        generation: 9,
        renderNode: '/dev/dri/renderD128',
    }, '{"outputId":17,"generation":9,"renderNode":"/dev/dri/renderD128"}', makeFdList([]));
    DisplayConsumer.calls.length = 0;
    presenter.showFrame({
        outputId: 17,
        generation: 9,
        bufferIndex: 0,
    }, makeFdList([101, 202]));

    const callNames = DisplayConsumer.calls.map(call => call[0]);
    assertIncludes(callNames, 'signal_release_syncobj', 'pending config release signal');
    assertDeepEqual(DisplayConsumer.calls, [
        ['close_fd', 101],
        ['signal_release_syncobj', '/dev/dri/renderD128', 202],
        ['close_fd', 202],
    ], 'pending config release signal before close');
}

function testRejectedFrameSignalsReleaseSyncobjBeforeCloseWhenAcquireWaitFails() {
    const DisplayConsumer = makeDisplayConsumerFake({acquireWaitOk: false});
    const presenter = new DisplayConnection.WaylandOutputPresenter({
        picture: {
            set_paintable() {},
        },
    }, {
        outputId: 'DP-1',
        consumerOutputId: 0,
        monitorIndex: 0,
        scale: 1,
        physicalWidth: 1920,
        physicalHeight: 1080,
    }, {
        DisplayConsumer,
    });

    presenter.bindBuffers({
        outputId: 17,
        generation: 11,
        'render-node': '/dev/dri/renderD129',
    }, '{"outputId":17,"generation":11,"render-node":"/dev/dri/renderD129"}', makeFdList([]));
    presenter.setConfig({
        outputId: 17,
        generation: 11,
    });
    DisplayConsumer.calls.length = 0;
    presenter.showFrame({
        outputId: 17,
        generation: 11,
        bufferIndex: 0,
    }, makeFdList([303, 404]));

    assertDeepEqual(DisplayConsumer.calls, [
        ['flush_pending_release_syncobj', 'wayland-frame-ready'],
        ['wait_sync_file', 303, 1000],
        ['close_fd', 303],
        ['signal_release_syncobj', '/dev/dri/renderD129', 404],
        ['close_fd', 404],
    ], 'acquire wait failure release signal before close');
}

function testRejectedFrameSignalsReleaseSyncobjBeforeCloseWhenPaintableRefreshFails() {
    const DisplayConsumer = makeDisplayConsumerFake({showFrameThrows: true});
    const presenter = new DisplayConnection.WaylandOutputPresenter({
        picture: {
            set_paintable() {},
        },
    }, {
        outputId: 'DP-1',
        consumerOutputId: 0,
        monitorIndex: 0,
        scale: 1,
        physicalWidth: 1920,
        physicalHeight: 1080,
    }, {
        DisplayConsumer,
    });

    presenter.bindBuffers({
        outputId: 17,
        generation: 12,
        renderNode: '/dev/dri/renderD130',
    }, '{"outputId":17,"generation":12,"renderNode":"/dev/dri/renderD130"}', makeFdList([]));
    presenter.setConfig({
        outputId: 17,
        generation: 12,
    });
    DisplayConsumer.calls.length = 0;
    presenter.showFrame({
        outputId: 17,
        generation: 12,
        bufferIndex: 0,
    }, makeFdList([505, 606]));

    assertDeepEqual(DisplayConsumer.calls, [
        ['flush_pending_release_syncobj', 'wayland-frame-ready'],
        ['wait_sync_file', 505, 1000],
        ['close_fd', 505],
        ['show_frame', 12, 0],
        ['signal_release_syncobj', '/dev/dri/renderD130', 606],
        ['unbind', 12],
        ['close_fd', 606],
    ], 'paintable refresh failure release signal before close');
}

[
    testStartupQueuesHelloCapsThenOutputRegistration,
    testSocketCloseClearsImportedOutputState,
    testReconnectResendsHelloCapsAndOutputs,
    testTopologyRebuildClearsOutputsBeforeReconnect,
    testConnectedRuntimeTopologyRebuildReconnectsBeforeReplayingHandshake,
    testProducerEventsDispatchToOutputImportPath,
    testClientReleasesBindBuffersOwnedFdListAfterSuccessfulHandling,
    testClientReleasesFrameReadyOwnedFdListAfterSuccessfulHandling,
    testClientReleasesBindBuffersOwnedFdListAfterUnknownOutput,
    testClientReleasesFrameReadyOwnedFdListAfterHandlerException,
    testAcceptedOutputsUpdateHyprlandPluginOutputMap,
    testOutputMapFileWriterWritesDocumentedJsonShape,
    testPointerMotionQueuesScaledBinaryFrameForAcceptedOutput,
    testPointerMotionIgnoresOutputWithoutBackendId,
    testClientQueuesPointerMotionThroughState,
    testClientCoalescesOnlyPendingPointerMotionFrames,
    testClientCoalescesPointerMotionPerBackendOutput,
    testRejectedFrameSignalsReleaseSyncobjBeforeCloseWhenConfigIsPending,
    testRejectedFrameSignalsReleaseSyncobjBeforeCloseWhenAcquireWaitFails,
    testRejectedFrameSignalsReleaseSyncobjBeforeCloseWhenPaintableRefreshFails,
].forEach(testCase => testCase());
