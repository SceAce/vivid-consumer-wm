const ProtocolPayloads = imports.protocolPayloads;

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
    }
}

function assertNotIncludes(values, expected, message) {
    if (values === undefined) {
        return;
    }

    if (values.includes(expected)) {
        throw new Error(`${message}: expected ${JSON.stringify(values)} not to include ${expected}`);
    }
}

function assertFeatureSet(actual, expected, message) {
    const actualJson = JSON.stringify([...actual].sort());
    const expectedJson = JSON.stringify([...expected].sort());
    if (actualJson !== expectedJson) {
        throw new Error(`${message}: expected ${expectedJson}, got ${actualJson}`);
    }
}

function testHelloIdentifiesWaylandConsumer() {
    const payload = ProtocolPayloads.buildHelloPayload({
        pointerEventsEnabled: false,
    });

    assertEqual(payload.type, 'REQ_HELLO', 'hello message type');
    assertEqual(payload.protocol, 'vivid-display-v1', 'hello protocol');
    assertEqual(payload.version, 1, 'hello protocol version');
    assertEqual(payload.role, 'consumer', 'hello role');
    assertEqual(payload.clientName, 'vivid-consumer-wayland', 'hello client name');
    assertFeatureSet(payload.features, [
        'dmabuf-gdk-texture-v1',
        'dmabuf-caps-v3',
        'explicit-sync-fd-v1',
        'dmabuf-bind-failed-v1',
        'dmabuf-unbind-done-v1',
        'dmabuf-shadow-copy-v1',
    ], 'hello base features');
}

function testHelloNeverAdvertisesPointerFeatureUntilForwardingExists() {
    const disabledPayload = ProtocolPayloads.buildHelloPayload({
        pointerEventsEnabled: false,
    });
    const enabledPayload = ProtocolPayloads.buildHelloPayload({
        pointerEventsEnabled: true,
    });

    assertNotIncludes(disabledPayload.features, 'pointer-events-v1', 'disabled hello pointer feature');
    assertNotIncludes(enabledPayload.features, 'pointer-events-v1', 'enabled hello pointer feature');
    assertNotIncludes(enabledPayload.features, 'media-state-v1', 'hello media feature');
    assertNotIncludes(enabledPayload.features, 'audio-samples-v1', 'hello audio feature');
}

function testConsumerCapsExcludeProtocolFeaturesAndMediaAudio() {
    const payload = ProtocolPayloads.buildConsumerCapsPayload({
        pointerEventsEnabled: false,
    });

    assertEqual(payload.features, undefined, 'consumer caps feature list');
    assertNotIncludes(payload.features, 'media-state-v1', 'media feature');
    assertNotIncludes(payload.features, 'audio-samples-v1', 'audio feature');
    assertNotIncludes(payload.features, 'pointer-events-v1', 'pointer feature');
    assertEqual(payload.mediaState, undefined, 'media state field');
    assertEqual(payload.audioSamples, undefined, 'audio samples field');
}

function testPointerCapabilityAlwaysFalseUntilForwardingExists() {
    const disabledPayload = ProtocolPayloads.buildConsumerCapsPayload({
        pointerEventsEnabled: false,
    });
    const enabledPayload = ProtocolPayloads.buildConsumerCapsPayload({
        pointerEventsEnabled: true,
    });

    assertEqual(disabledPayload.features, undefined, 'disabled consumer caps feature list');
    assertEqual(enabledPayload.features, undefined, 'enabled consumer caps feature list');
    assertEqual(disabledPayload.pointerEvents, false, 'disabled pointer events field');
    assertEqual(enabledPayload.pointerEvents, false, 'enabled pointer events field');
}

function testConsumerCapsExposeFutureProducerFieldsWithoutFakeDmabufCaps() {
    const dmabufCaps = {
        version: 3,
        backend: 'test-dmabuf-backend',
    };
    const payload = ProtocolPayloads.buildConsumerCapsPayload({
        pointerEventsEnabled: false,
        renderer: 'gtk4-gdk-wayland',
        dmabufCaps,
    });

    assertEqual(payload.bufferImports[0].memoryType, 'dmabuf', 'buffer import memory type');
    assertEqual(payload.bufferImports[0].renderer, 'gtk4-gdk-wayland', 'buffer import renderer');
    assertEqual(payload.explicitSync, true, 'explicit sync field');
    assertEqual(payload.pointerEvents, false, 'pointer events field');
    assertEqual(payload.mediaState, undefined, 'media state field');
    assertEqual(payload.audioSamples, undefined, 'audio samples field');
    assertEqual(payload.dmabufCaps, dmabufCaps, 'dmabuf caps input object');
}

function testOutputRegistrationUsesSameFeaturePolicy() {
    const payload = ProtocolPayloads.buildOutputRegistrationPayload({
        outputId: 'HDMI-A-1',
        compositor: 'hyprland',
        pointerEventsEnabled: true,
    });

    assertEqual(payload.type, 'REQ_REGISTER_OUTPUT', 'output registration message type');
    assertEqual(payload.outputId, 'HDMI-A-1', 'output id');
    assertEqual(payload.compositor, 'hyprland', 'output compositor');
    assertEqual(payload.features, undefined, 'output registration feature list');
    assertEqual(payload.pointerEventsEnabled, undefined, 'output registration pointer option');
}

[
    testHelloIdentifiesWaylandConsumer,
    testHelloNeverAdvertisesPointerFeatureUntilForwardingExists,
    testConsumerCapsExcludeProtocolFeaturesAndMediaAudio,
    testPointerCapabilityAlwaysFalseUntilForwardingExists,
    testConsumerCapsExposeFutureProducerFieldsWithoutFakeDmabufCaps,
    testOutputRegistrationUsesSameFeaturePolicy,
].forEach(testCase => testCase());
