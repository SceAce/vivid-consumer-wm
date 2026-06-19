imports.searchPath.unshift(imports.system.programPath);

const RuntimeArgs = imports.runtimeArgs;

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

function assertThrows(fn, expectedMessage, message) {
    try {
        fn();
    } catch (error) {
        if (error.message !== expectedMessage) {
            throw new Error(`${message}: expected "${expectedMessage}", got "${error.message}"`);
        }
        return;
    }

    throw new Error(`${message}: expected error "${expectedMessage}"`);
}

function testDefaultSocketPath() {
    const options = RuntimeArgs.parseRuntimeArgs([], {
        runtimeDir: '/run/user/1000',
    });

    assertEqual(options.socketPath, '/run/user/1000/vivid/display-v1.sock', 'default socket path');
}

function testSocketOverride() {
    const options = RuntimeArgs.parseRuntimeArgs(['--socket', '/tmp/vivid.sock'], {
        runtimeDir: '/run/user/1000',
    });

    assertEqual(options.socketPath, '/tmp/vivid.sock', 'socket override');
}

function testDefaultCompositorMode() {
    const options = RuntimeArgs.parseRuntimeArgs([], {
        runtimeDir: '/run/user/1000',
    });

    assertEqual(options.compositor, 'auto', 'default compositor mode');
}

function testSupportedCompositorModes() {
    assertDeepEqual(RuntimeArgs.SUPPORTED_COMPOSITORS, ['auto', 'generic', 'hyprland', 'niri'], 'supported compositor modes');

    for (const compositor of RuntimeArgs.SUPPORTED_COMPOSITORS) {
        const options = RuntimeArgs.parseRuntimeArgs(['--compositor', compositor], {
            runtimeDir: '/run/user/1000',
        });

        assertEqual(options.compositor, compositor, `${compositor} compositor mode`);
    }
}

function testInputDisabledByDefault() {
    const options = RuntimeArgs.parseRuntimeArgs([], {
        runtimeDir: '/run/user/1000',
    });

    assertEqual(options.pointerEventsEnabled, false, 'pointer events default');
}

function testPointerFeatureAdvertisementEnabled() {
    const options = RuntimeArgs.parseRuntimeArgs(['--enable-pointer-events'], {
        runtimeDir: '/run/user/1000',
    });

    assertEqual(options.pointerEventsEnabled, true, 'pointer events enabled');
}

function testMissingSocketPathFails() {
    assertThrows(
        () => RuntimeArgs.parseRuntimeArgs(['--socket'], {runtimeDir: '/run/user/1000'}),
        '--socket requires a path',
        'missing socket path',
    );
}

function testMissingCompositorModeFails() {
    assertThrows(
        () => RuntimeArgs.parseRuntimeArgs(['--compositor'], {runtimeDir: '/run/user/1000'}),
        '--compositor requires a mode',
        'missing compositor mode',
    );
}

function testInvalidCompositorModeFails() {
    assertThrows(
        () => RuntimeArgs.parseRuntimeArgs(['--compositor', 'sway'], {runtimeDir: '/run/user/1000'}),
        'Unsupported compositor mode: sway',
        'invalid compositor mode',
    );
}

function testUnknownArgumentFails() {
    assertThrows(
        () => RuntimeArgs.parseRuntimeArgs(['--display', '1'], {runtimeDir: '/run/user/1000'}),
        'Unknown argument: --display',
        'unknown argument',
    );
}

[
    testDefaultSocketPath,
    testSocketOverride,
    testDefaultCompositorMode,
    testSupportedCompositorModes,
    testInputDisabledByDefault,
    testPointerFeatureAdvertisementEnabled,
    testMissingSocketPathFails,
    testMissingCompositorModeFails,
    testInvalidCompositorModeFails,
    testUnknownArgumentFails,
].forEach(testCase => testCase());
