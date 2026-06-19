const OutputModel = imports.outputModel;

function assertEqual(actual, expected, message) {
    if (actual !== expected) {
        throw new Error(`${message}: expected ${expected}, got ${actual}`);
    }
}

function testMonitorLikeModelConvertsToDisplayOutputRegistration() {
    const monitor = {
        connector: 'DP-1',
        x: 10,
        y: 20,
        logicalWidth: 1920,
        logicalHeight: 1080,
        scale: 2,
        index: 1,
    };

    const output = OutputModel.outputRegistrationFromMonitor(monitor);

    assertEqual(output.outputId, 'DP-1', 'output id');
    assertEqual(output.consumerOutputId, 1, 'consumer output id');
    assertEqual(output.x, 10, 'x position');
    assertEqual(output.y, 20, 'y position');
    assertEqual(output.width, 1920, 'protocol width');
    assertEqual(output.height, 1080, 'protocol height');
    assertEqual(output.logicalWidth, 1920, 'logical width');
    assertEqual(output.logicalHeight, 1080, 'logical height');
    assertEqual(output.scale, 2, 'scale');
    assertEqual(output.physicalWidth, 3840, 'physical width');
    assertEqual(output.physicalHeight, 2160, 'physical height');
    assertEqual(output.monitorIndex, 1, 'monitor index');
    assertEqual(output.transform, 'normal', 'default transform');
    assertEqual(output.refreshRate, 0, 'safe default refresh rate');
    assertEqual(output.refreshRateMhz, 0, 'safe default refresh rate mhz');
    assertEqual(output.compositor, 'generic', 'compositor field');
    assertEqual(output.desktop, 'wayland-layer-shell', 'desktop field');
}

function testGdkMonitorLikeModelConvertsToDisplayOutputRegistration() {
    const monitor = {
        get_connector() {
            return 'HDMI-A-1';
        },
        get_geometry() {
            return {
                x: 100,
                y: 200,
                width: 2560,
                height: 1440,
            };
        },
        get_scale() {
            return 1.5;
        },
        get_refresh_rate() {
            return 59940;
        },
    };

    const output = OutputModel.outputRegistrationFromGdkMonitor(monitor, 2, {
        compositor: 'hyprland',
    });

    assertEqual(output.outputId, 'HDMI-A-1', 'gdk output id');
    assertEqual(output.consumerOutputId, 2, 'gdk consumer output id');
    assertEqual(output.x, 100, 'gdk x position');
    assertEqual(output.y, 200, 'gdk y position');
    assertEqual(output.logicalWidth, 2560, 'gdk logical width');
    assertEqual(output.logicalHeight, 1440, 'gdk logical height');
    assertEqual(output.width, 2560, 'gdk protocol width');
    assertEqual(output.height, 1440, 'gdk protocol height');
    assertEqual(output.scale, 1.5, 'gdk scale');
    assertEqual(output.physicalWidth, 3840, 'gdk physical width');
    assertEqual(output.physicalHeight, 2160, 'gdk physical height');
    assertEqual(output.monitorIndex, 2, 'gdk monitor index');
    assertEqual(output.transform, 'normal', 'gdk default transform');
    assertEqual(output.refreshRate, 59940, 'gdk refresh rate');
    assertEqual(output.refreshRateMhz, 59940, 'gdk refresh rate mhz');
    assertEqual(output.compositor, 'hyprland', 'gdk compositor field');
    assertEqual(output.desktop, 'wayland-layer-shell', 'gdk desktop field');
}

[
    testMonitorLikeModelConvertsToDisplayOutputRegistration,
    testGdkMonitorLikeModelConvertsToDisplayOutputRegistration,
].forEach(testCase => testCase());
