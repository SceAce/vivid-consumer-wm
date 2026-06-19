const HyprlandPointer = imports.hyprlandPointer;

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

function makeTimer() {
    return {
        added: [],
        removed: [],
        add(intervalMs, callback) {
            this.added.push([intervalMs, callback]);
            return 99;
        },
        remove(sourceId) {
            this.removed.push(sourceId);
        },
    };
}

function makeConnection(calls) {
    return {
        queuePointerMotion(output, x, y, timeUsec) {
            calls.push([output.outputId, x, y, timeUsec]);
            return true;
        },
    };
}

function testParsesJsonCursorPosition() {
    assertDeepEqual(
        HyprlandPointer.parseCursorPosition('{"x":123.5,"y":456}'),
        {x: 123.5, y: 456},
        'json cursor position',
    );
}

function testParsesPlainCursorPosition() {
    assertDeepEqual(
        HyprlandPointer.parseCursorPosition('123, 456\n'),
        {x: 123, y: 456},
        'plain cursor position',
    );
}

function testMapsGlobalCursorToOutputLocalMotion() {
    const calls = [];
    const provider = new HyprlandPointer.HyprlandPointerProvider({
        outputs: [{
            outputId: 'DP-1',
            x: 0,
            y: 0,
            logicalWidth: 100,
            logicalHeight: 100,
        }, {
            outputId: 'HDMI-A-1',
            x: 100,
            y: 0,
            logicalWidth: 200,
            logicalHeight: 100,
        }],
        connection: makeConnection(calls),
        commandRunner: () => ({ok: true, stdout: '{"x":150,"y":25}'}),
        monotonicTimeUsec: () => 777,
    });

    assertEqual(provider.pollOnce(), true, 'poll sends motion');
    assertDeepEqual(calls, [['HDMI-A-1', 50, 25, 777]], 'local motion call');
}

function testMapsPresenterRegistrationGeometryAndSendsPresenter() {
    const calls = [];
    const presenter = {
        outputId: 'HDMI-A-1-presenter',
        backendOutputId: 22,
        scale: 2,
        registration: {
            outputId: 'HDMI-A-1',
            x: 100,
            y: 50,
            logicalWidth: 200,
            logicalHeight: 100,
            scale: 2,
        },
    };
    const provider = new HyprlandPointer.HyprlandPointerProvider({
        outputs: [presenter],
        connection: {
            queuePointerMotion(output, x, y, timeUsec) {
                calls.push([output, x, y, timeUsec]);
                return true;
            },
        },
        commandRunner: () => ({ok: true, stdout: '{"x":150,"y":75}'}),
        monotonicTimeUsec: () => 888,
    });

    assertEqual(provider.pollOnce(), true, 'presenter poll sends motion');
    assertEqual(calls.length, 1, 'presenter motion call count');
    assertEqual(calls[0][0], presenter, 'presenter object passed to connection');
    assertDeepEqual(calls[0].slice(1), [50, 25, 888], 'presenter local motion call');
}

function testIgnoresOutOfOutputCursorPosition() {
    const calls = [];
    const provider = new HyprlandPointer.HyprlandPointerProvider({
        outputs: [{
            outputId: 'DP-1',
            x: 0,
            y: 0,
            logicalWidth: 100,
            logicalHeight: 100,
        }],
        connection: makeConnection(calls),
        commandRunner: command => command.endsWith('-j')
            ? {ok: false, stdout: ''}
            : {ok: true, stdout: '150, 25'},
        monotonicTimeUsec: () => 777,
    });

    assertEqual(provider.pollOnce(), false, 'out of output poll ignored');
    assertDeepEqual(calls, [], 'no out of output motion call');
}

function testSuppressesDuplicateCursorPositionOnSameOutput() {
    const calls = [];
    const provider = new HyprlandPointer.HyprlandPointerProvider({
        outputs: [{
            outputId: 'DP-1',
            x: 0,
            y: 0,
            logicalWidth: 100,
            logicalHeight: 100,
        }],
        connection: makeConnection(calls),
        commandRunner: command => command.endsWith('-j')
            ? {ok: false, stdout: ''}
            : {ok: true, stdout: '10, 20'},
        monotonicTimeUsec: () => 777,
    });

    assertEqual(provider.pollOnce(), true, 'first poll sends motion');
    assertEqual(provider.pollOnce(), false, 'duplicate poll ignored');
    assertDeepEqual(calls, [['DP-1', 10, 20, 777]], 'single duplicate-suppressed motion call');
}

function testUpdatesOutputsAndStopsTimer() {
    const calls = [];
    const timer = makeTimer();
    const provider = new HyprlandPointer.HyprlandPointerProvider({
        outputs: [],
        connection: makeConnection(calls),
        commandRunner: command => command.endsWith('-j')
            ? {ok: false, stdout: ''}
            : {ok: true, stdout: '10, 20'},
        timer,
    });

    provider.start();
    provider.updateOutputs([{
        outputId: 'DP-1',
        x: 0,
        y: 0,
        logicalWidth: 100,
        logicalHeight: 100,
    }]);
    assertEqual(timer.added.length, 1, 'timer started once');
    assertEqual(provider.pollOnce(), true, 'updated output receives motion');
    provider.stop();

    assertDeepEqual(calls.map(call => call[0]), ['DP-1'], 'updated output motion call');
    assertDeepEqual(timer.removed, [99], 'timer removed on stop');
}

function testSuppressesRepeatedHyprctlFailureLogs() {
    const logs = [];
    const provider = new HyprlandPointer.HyprlandPointerProvider({
        outputs: [{
            outputId: 'DP-1',
            x: 0,
            y: 0,
            logicalWidth: 100,
            logicalHeight: 100,
        }],
        connection: makeConnection([]),
        commandRunner: () => ({
            ok: false,
            stdout: '',
            stderr: "Couldn't set socket timeout (2)",
        }),
        log: message => logs.push(message),
    });

    assertEqual(provider.pollOnce(), false, 'first failed poll is non-fatal');
    assertEqual(provider.pollOnce(), false, 'second failed poll is non-fatal');
    assertDeepEqual(logs, [
        "hyprctl cursorpos failed: Couldn't set socket timeout (2)",
    ], 'identical hyprctl failures are logged once');
}

[
    testParsesJsonCursorPosition,
    testParsesPlainCursorPosition,
    testMapsGlobalCursorToOutputLocalMotion,
    testMapsPresenterRegistrationGeometryAndSendsPresenter,
    testIgnoresOutOfOutputCursorPosition,
    testSuppressesDuplicateCursorPositionOnSameOutput,
    testUpdatesOutputsAndStopsTimer,
    testSuppressesRepeatedHyprctlFailureLogs,
].forEach(testCase => testCase());
