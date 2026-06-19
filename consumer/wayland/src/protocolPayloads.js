var CLIENT_NAME = 'vivid-consumer-wayland';
var PROTOCOL_NAME = 'vivid-display-v1';
var PROTOCOL_VERSION = 1;
var CLIENT_ROLE = 'consumer';
var BASE_CONSUMER_FEATURES = [
    'dmabuf-gdk-texture-v1',
    'dmabuf-caps-v3',
    'explicit-sync-fd-v1',
    'dmabuf-bind-failed-v1',
    'dmabuf-unbind-done-v1',
    'dmabuf-shadow-copy-v1',
];
var POINTER_FEATURE = 'pointer-events-v1';
var DEFAULT_RENDERER = 'gtk4-gdk-wayland';

function consumerFeatures(options = {}) {
    const features = [...BASE_CONSUMER_FEATURES];
    if (options.pointerEventsEnabled) {
        features.push(POINTER_FEATURE);
    }

    return features;
}

function buildHelloPayload(options = {}) {
    return {
        type: 'REQ_HELLO',
        protocol: PROTOCOL_NAME,
        version: PROTOCOL_VERSION,
        role: CLIENT_ROLE,
        clientName: CLIENT_NAME,
        features: consumerFeatures(options),
    };
}

function buildConsumerCapsPayload(options = {}) {
    const payload = {
        type: 'REQ_CONSUMER_CAPS',
        bufferImports: [{
            memoryType: 'dmabuf',
            renderer: options.renderer || DEFAULT_RENDERER,
        }],
        explicitSync: true,
        pointerEvents: Boolean(options.pointerEventsEnabled),
    };

    if (options.dmabufCaps !== undefined) {
        payload.dmabufCaps = options.dmabufCaps;
    }

    return payload;
}

function buildOutputRegistrationPayload(options = {}) {
    return {
        type: 'REQ_REGISTER_OUTPUT',
        outputId: options.outputId,
        compositor: options.compositor || 'auto',
    };
}

var ProtocolPayloads = {
    CLIENT_NAME,
    PROTOCOL_NAME,
    PROTOCOL_VERSION,
    CLIENT_ROLE,
    BASE_CONSUMER_FEATURES,
    consumerFeatures,
    buildHelloPayload,
    buildConsumerCapsPayload,
    buildOutputRegistrationPayload,
};
