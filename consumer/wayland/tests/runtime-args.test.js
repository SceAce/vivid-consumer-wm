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

function testPointerFeatureRequestRequiresHyprlandPluginForHyprland() {
    const options = RuntimeArgs.parseRuntimeArgs([
        '--compositor', 'hyprland',
        '--enable-pointer-events',
    ], {
        runtimeDir: '/run/user/1000',
    });

    assertEqual(options.pointerEventsRequested, true, 'hyprland pointer events requested');
    assertEqual(options.pointerEventsEnabled, false, 'hyprland wayland pointer events disabled');
    assertEqual(options.requiresHyprlandPlugin, true, 'hyprland plugin required');
}

function testPointerFeatureRequestUsesAutoDetectedHyprland() {
    const options = RuntimeArgs.parseRuntimeArgs(['--enable-pointer-events'], {
        runtimeDir: '/run/user/1000',
        env(name) {
            return name === 'HYPRLAND_INSTANCE_SIGNATURE' ? 'test-hyprland' : null;
        },
    });

    assertEqual(options.compositor, 'hyprland', 'auto-detected compositor mode');
    assertEqual(options.pointerEventsRequested, true, 'auto-detected pointer events requested');
    assertEqual(options.pointerEventsEnabled, false, 'auto-detected wayland pointer events disabled');
    assertEqual(options.requiresHyprlandPlugin, true, 'auto-detected hyprland plugin required');
}

function testExplicitAutoPointerFeatureRequestUsesAutoDetectedHyprland() {
    const options = RuntimeArgs.parseRuntimeArgs([
        '--compositor', 'auto',
        '--enable-pointer-events',
    ], {
        runtimeDir: '/run/user/1000',
        env(name) {
            return name === 'HYPRLAND_INSTANCE_SIGNATURE' ? 'test-hyprland' : null;
        },
    });

    assertEqual(options.compositor, 'hyprland', 'explicit auto-detected compositor mode');
    assertEqual(options.pointerEventsRequested, true, 'explicit auto-detected pointer events requested');
    assertEqual(options.pointerEventsEnabled, false, 'explicit auto-detected wayland pointer events disabled');
    assertEqual(options.requiresHyprlandPlugin, true, 'explicit auto-detected hyprland plugin required');
}

function testNoInputDisablesPointerEvents() {
    const options = RuntimeArgs.parseRuntimeArgs([
        '--compositor', 'hyprland',
        '--enable-pointer-events',
        '--no-input',
    ], {
        runtimeDir: '/run/user/1000',
    });

    assertEqual(options.pointerEventsEnabled, false, 'no-input disables pointer events');
    assertEqual(options.requiresHyprlandPlugin, false, 'no-input skips hyprland plugin requirement');
}

function testNoInputDisablesPointerEventsRegardlessOfArgumentOrder() {
    const options = RuntimeArgs.parseRuntimeArgs([
        '--compositor', 'hyprland',
        '--no-input',
        '--enable-pointer-events',
    ], {
        runtimeDir: '/run/user/1000',
    });

    assertEqual(options.pointerEventsEnabled, false, 'no-input disables later pointer events flag');
    assertEqual(options.requiresHyprlandPlugin, false, 'no-input skips later hyprland plugin requirement');
}

function testPointerFeatureAdvertisementIsAcceptedButDisabledForGenericAndNiri() {
    for (const compositor of ['generic', 'niri']) {
        const options = RuntimeArgs.parseRuntimeArgs([
            '--compositor', compositor,
            '--enable-pointer-events',
        ], {runtimeDir: '/run/user/1000'});

        assertEqual(options.pointerEventsEnabled, false, `${compositor} pointer events disabled`);
        assertEqual(options.requiresHyprlandPlugin, false, `${compositor} hyprland plugin not required`);
    }
}

function testPointerFeatureAdvertisementIsAcceptedButDisabledForUndetectedAutoMode() {
    const options = RuntimeArgs.parseRuntimeArgs(['--enable-pointer-events'], {
        runtimeDir: '/run/user/1000',
        env() {
            return null;
        },
    });

    assertEqual(options.compositor, 'auto', 'undetected auto compositor mode');
    assertEqual(options.pointerEventsEnabled, false, 'undetected auto pointer events disabled');
    assertEqual(options.requiresHyprlandPlugin, false, 'undetected auto hyprland plugin not required');
}

function testInvalidCompositorModeStillFailsWithPointerFlag() {
    assertThrows(
        () => RuntimeArgs.parseRuntimeArgs([
            '--compositor', 'sway',
            '--enable-pointer-events',
        ], {runtimeDir: '/run/user/1000'}),
        'Unsupported compositor mode: sway',
        'invalid compositor mode with pointer flag',
    );
}

function testHiddenExitAfterMsOption() {
    const options = RuntimeArgs.parseRuntimeArgs(['--exit-after-ms', '250'], {
        runtimeDir: '/run/user/1000',
    });

    assertEqual(options.exitAfterMs, 250, 'bounded runtime duration');
}

function testInvalidExitAfterMsFails() {
    assertThrows(
        () => RuntimeArgs.parseRuntimeArgs(['--exit-after-ms', '0'], {runtimeDir: '/run/user/1000'}),
        '--exit-after-ms requires a positive integer',
        'zero exit-after-ms',
    );
    assertThrows(
        () => RuntimeArgs.parseRuntimeArgs(['--exit-after-ms', 'later'], {runtimeDir: '/run/user/1000'}),
        '--exit-after-ms requires a positive integer',
        'non-numeric exit-after-ms',
    );
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
    testPointerFeatureRequestRequiresHyprlandPluginForHyprland,
    testPointerFeatureRequestUsesAutoDetectedHyprland,
    testExplicitAutoPointerFeatureRequestUsesAutoDetectedHyprland,
    testNoInputDisablesPointerEvents,
    testNoInputDisablesPointerEventsRegardlessOfArgumentOrder,
    testPointerFeatureAdvertisementIsAcceptedButDisabledForGenericAndNiri,
    testPointerFeatureAdvertisementIsAcceptedButDisabledForUndetectedAutoMode,
    testInvalidCompositorModeStillFailsWithPointerFlag,
    testHiddenExitAfterMsOption,
    testInvalidExitAfterMsFails,
    testMissingSocketPathFails,
    testMissingCompositorModeFails,
    testInvalidCompositorModeFails,
    testUnknownArgumentFails,
].forEach(testCase => testCase());
