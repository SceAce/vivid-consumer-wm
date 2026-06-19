const DisplayConnection = imports.displayConnection;

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

function makeOutput(outputId, consumerOutputId = 0) {
    const calls = [];
    return {
        outputId,
        consumerOutputId,
        monitorIndex: consumerOutputId,
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

function queuedTypes(state) {
    return state.takeQueuedFrames().map(frame => frame.payload.type);
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
    const state = DisplayConnection.createConnectionState({outputs: [output]});
    state.onConnected();
    state.dispatchEvent('EVT_OUTPUT_ACCEPTED', {
        consumerOutputId: 0,
        outputId: 44,
    });

    state.onSocketClosed();

    assertEqual(output.backendOutputId, null, 'backend output id cleared');
    assertDeepEqual(output.calls, [['clear']], 'output clear call');
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
    testRejectedFrameSignalsReleaseSyncobjBeforeCloseWhenConfigIsPending,
    testRejectedFrameSignalsReleaseSyncobjBeforeCloseWhenAcquireWaitFails,
    testRejectedFrameSignalsReleaseSyncobjBeforeCloseWhenPaintableRefreshFails,
].forEach(testCase => testCase());
