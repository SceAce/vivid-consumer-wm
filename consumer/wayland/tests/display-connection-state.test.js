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

[
    testStartupQueuesHelloCapsThenOutputRegistration,
    testSocketCloseClearsImportedOutputState,
    testReconnectResendsHelloCapsAndOutputs,
    testTopologyRebuildClearsOutputsBeforeReconnect,
    testProducerEventsDispatchToOutputImportPath,
].forEach(testCase => testCase());
