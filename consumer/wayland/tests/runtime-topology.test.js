const RuntimeTopology = imports.runtimeTopology;

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

function makeMonitorList(monitors) {
    const handlers = {};
    return {
        handlers,
        get_n_items() {
            return monitors.length;
        },
        get_item(index) {
            return monitors[index];
        },
        connect(signal, callback) {
            handlers[signal] = callback;
            return 41;
        },
        disconnect(id) {
            this.disconnected = id;
        },
        replace(nextMonitors) {
            monitors = nextMonitors;
            handlers['items-changed']?.(this, 0, 0, nextMonitors.length);
        },
    };
}

function makeDisplay(monitors) {
    const monitorList = makeMonitorList(monitors);
    return {
        monitorList,
        get_monitors() {
            return monitorList;
        },
    };
}

function makeSurfaceFactory(calls) {
    return monitors => monitors.map(monitor => {
        const surface = {
            monitor,
            destroyed: false,
            window: {
                close() {
                    surface.destroyed = true;
                },
            },
            picture: {
                set_paintable() {},
            },
        };
        calls.push(['createSurface', monitor.id]);
        return surface;
    });
}

function makePresenterFactory(calls) {
    return (surface, output) => {
        const presenter = {
            surface,
            output,
            consumerOutputId: output.consumerOutputId,
            clear() {
                calls.push(['clearPresenter', output.outputId]);
            },
        };
        calls.push(['createPresenter', output.outputId]);
        return presenter;
    };
}

function outputFromMonitor(monitor, index, options) {
    return {
        outputId: monitor.id,
        consumerOutputId: index,
        monitorIndex: index,
        compositor: options.compositor,
    };
}

function testInitialBuildCreatesSurfacesAndPresenters() {
    const calls = [];
    const display = makeDisplay([{id: 'DP-1'}, {id: 'HDMI-A-1'}]);
    const controller = new RuntimeTopology.TopologyController({
        display,
        compositor: 'generic',
        createSurfaces: makeSurfaceFactory(calls),
        destroySurfaces: surfaces => surfaces.forEach(surface => surface.window.close()),
        createPresenter: makePresenterFactory(calls),
        outputFromMonitor,
        log: message => calls.push(['log', message]),
    });

    const presenters = controller.buildInitial();

    assertEqual(presenters.length, 2, 'initial presenter count');
    assertDeepEqual(calls, [
        ['createSurface', 'DP-1'],
        ['createSurface', 'HDMI-A-1'],
        ['createPresenter', 'DP-1'],
        ['createPresenter', 'HDMI-A-1'],
    ], 'initial build calls');
}

function testMonitorItemsChangedDestroysSurfacesAndReconnectsWithNewPresenters() {
    const calls = [];
    const display = makeDisplay([{id: 'DP-1'}]);
    const connection = {
        rebuildTopology(presenters) {
            calls.push(['rebuildConnection', presenters.map(presenter => presenter.output.outputId)]);
        },
    };
    const controller = new RuntimeTopology.TopologyController({
        display,
        compositor: 'generic',
        createSurfaces: makeSurfaceFactory(calls),
        destroySurfaces: surfaces => {
            calls.push(['destroySurfaces', surfaces.map(surface => surface.monitor.id)]);
            surfaces.forEach(surface => surface.window.close());
        },
        createPresenter: makePresenterFactory(calls),
        outputFromMonitor,
        log: message => calls.push(['log', message]),
    });
    controller.buildInitial();
    calls.length = 0;
    controller.watch(connection);

    display.monitorList.replace([{id: 'DP-2'}, {id: 'HDMI-A-2'}]);

    assertDeepEqual(calls, [
        ['destroySurfaces', ['DP-1']],
        ['createSurface', 'DP-2'],
        ['createSurface', 'HDMI-A-2'],
        ['createPresenter', 'DP-2'],
        ['createPresenter', 'HDMI-A-2'],
        ['rebuildConnection', ['DP-2', 'HDMI-A-2']],
    ], 'topology rebuild calls');
}

function testMonitorItemsChangedToEmptyClearsSurfacesAndProducerTopology() {
    const calls = [];
    const display = makeDisplay([{id: 'DP-1'}]);
    const connection = {
        rebuildTopology(presenters) {
            calls.push(['rebuildConnection', presenters.length]);
        },
    };
    const controller = new RuntimeTopology.TopologyController({
        display,
        compositor: 'generic',
        createSurfaces: makeSurfaceFactory(calls),
        destroySurfaces: surfaces => {
            calls.push(['destroySurfaces', surfaces.map(surface => surface.monitor.id)]);
        },
        createPresenter: makePresenterFactory(calls),
        outputFromMonitor,
        log: message => calls.push(['log', message]),
    });
    controller.buildInitial();
    calls.length = 0;
    controller.watch(connection);

    display.monitorList.replace([]);

    assertDeepEqual(calls, [
        ['destroySurfaces', ['DP-1']],
        ['log', 'No GDK monitors are available after topology change; clearing producer outputs.'],
        ['rebuildConnection', 0],
    ], 'empty topology clears producer outputs');
}

function testMonitorItemsChangedNotifiesPresenterCallback() {
    const calls = [];
    const display = makeDisplay([{id: 'DP-1'}]);
    const controller = new RuntimeTopology.TopologyController({
        display,
        compositor: 'generic',
        createSurfaces: makeSurfaceFactory(calls),
        destroySurfaces: surfaces => {
            calls.push(['destroySurfaces', surfaces.map(surface => surface.monitor.id)]);
        },
        createPresenter: makePresenterFactory(calls),
        outputFromMonitor,
        onPresentersChanged: presenters => {
            calls.push(['presentersChanged', presenters.map(presenter => presenter.output.outputId)]);
        },
        log: message => calls.push(['log', message]),
    });
    controller.buildInitial();
    calls.length = 0;
    controller.watch({
        rebuildTopology(presenters) {
            calls.push(['rebuildConnection', presenters.map(presenter => presenter.output.outputId)]);
        },
    });

    display.monitorList.replace([{id: 'DP-2'}]);

    assertDeepEqual(calls, [
        ['destroySurfaces', ['DP-1']],
        ['createSurface', 'DP-2'],
        ['createPresenter', 'DP-2'],
        ['rebuildConnection', ['DP-2']],
        ['presentersChanged', ['DP-2']],
    ], 'topology rebuild presenter callback');
}

[
    testInitialBuildCreatesSurfacesAndPresenters,
    testMonitorItemsChangedDestroysSurfacesAndReconnectsWithNewPresenters,
    testMonitorItemsChangedToEmptyClearsSurfacesAndProducerTopology,
    testMonitorItemsChangedNotifiesPresenterCallback,
].forEach(testCase => testCase());
