const LayerShellSurfaces = imports.layerShellSurfaces;

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

function makeGtkFake() {
    return {
        windows: [],
        pictures: [],
        Window: class {
            constructor(props) {
                this.props = props;
                this.child = null;
                this.presented = false;
                this.inputRegion = undefined;
                this.monitor = undefined;
                this.layerShell = {
                    anchors: [],
                };
                this.constructor.registry.push(this);
            }

            set_child(child) {
                this.child = child;
            }

            set_input_region(region) {
                this.inputRegion = region;
            }

            present() {
                this.presented = true;
            }
        },
        Picture: class {
            constructor(props) {
                this.props = props;
                this.constructor.registry.push(this);
            }
        },
    };
}

function makeLayerShellFake(hasBackgroundLayer = true) {
    const calls = [];
    const layer = hasBackgroundLayer ? {
        BACKGROUND: 'background',
        BOTTOM: 'bottom',
    } : {
        BOTTOM: 'bottom',
    };

    return {
        calls,
        Layer: layer,
        Edge: {
            LEFT: 'left',
            RIGHT: 'right',
            TOP: 'top',
            BOTTOM: 'bottom',
        },
        KeyboardMode: {
            NONE: 'none',
        },
        init_for_window(window) {
            calls.push(['init_for_window', window]);
        },
        set_namespace(window, namespace) {
            window.layerShell.namespace = namespace;
        },
        set_layer(window, selectedLayer) {
            window.layerShell.layer = selectedLayer;
        },
        set_anchor(window, edge, enabled) {
            window.layerShell.anchors.push([edge, enabled]);
        },
        set_exclusive_zone(window, zone) {
            window.layerShell.exclusiveZone = zone;
        },
        set_keyboard_mode(window, mode) {
            window.layerShell.keyboardMode = mode;
        },
        set_monitor(window, monitor) {
            window.monitor = monitor;
        },
    };
}

function makeGdkFake() {
    return {
        Rectangle: class {
            constructor(props) {
                this.props = props;
            }
        },
    };
}

function installGtkRegistries(Gtk) {
    Gtk.Window.registry = Gtk.windows;
    Gtk.Picture.registry = Gtk.pictures;
}

function testCreatesOneBackgroundSurfacePerMonitor() {
    const Gtk = makeGtkFake();
    installGtkRegistries(Gtk);
    const LayerShell = makeLayerShellFake();
    const Gdk = makeGdkFake();
    const monitors = [{id: 'monitor-0'}, {id: 'monitor-1'}];

    const surfaces = LayerShellSurfaces.createWallpaperSurfaces(monitors, {
        Gtk,
        Gdk,
        LayerShell,
        pointerEventsEnabled: false,
    });

    assertEqual(surfaces.length, 2, 'surface count');
    assertEqual(Gtk.windows.length, 2, 'window count');
    assertEqual(Gtk.pictures.length, 2, 'picture count');

    for (const [index, surface] of surfaces.entries()) {
        assertEqual(surface.monitor, monitors[index], `surface ${index} monitor`);
        assertEqual(surface.window.monitor, monitors[index], `window ${index} monitor`);
        assertEqual(surface.window.layerShell.namespace, 'vivid-wallpaper', `window ${index} namespace`);
        assertEqual(surface.window.layerShell.layer, 'background', `window ${index} layer`);
        assertEqual(surface.window.layerShell.exclusiveZone, 0, `window ${index} exclusive zone`);
        assertEqual(surface.window.layerShell.keyboardMode, 'none', `window ${index} keyboard mode`);
        assertEqual(surface.window.inputRegion.props.width, 0, `window ${index} empty input width`);
        assertEqual(surface.window.inputRegion.props.height, 0, `window ${index} empty input height`);
        assertEqual(surface.window.child, surface.picture, `window ${index} picture child`);
        assertEqual(surface.window.presented, true, `window ${index} presented`);
        assertDeepEqual(surface.window.layerShell.anchors, [
            ['left', true],
            ['right', true],
            ['top', true],
            ['bottom', true],
        ], `window ${index} anchors`);
    }
}

function testFallsBackToBottomLayerWhenBackgroundEnumIsUnavailable() {
    const Gtk = makeGtkFake();
    installGtkRegistries(Gtk);
    const LayerShell = makeLayerShellFake(false);
    const Gdk = makeGdkFake();

    const [surface] = LayerShellSurfaces.createWallpaperSurfaces([{id: 'monitor-0'}], {
        Gtk,
        Gdk,
        LayerShell,
        pointerEventsEnabled: true,
    });

    assertEqual(surface.window.layerShell.layer, 'bottom', 'fallback layer');
    assertEqual(surface.window.inputRegion, undefined, 'pointer-enabled input region');
}

function testEmptyInputRegionDoesNotForceEarlyRealizeWithoutDirectSetter() {
    const Gtk = makeGtkFake();
    installGtkRegistries(Gtk);
    Gtk.Window = class {
        constructor(props) {
            this.props = props;
            this.child = null;
            this.realized = false;
            this.presented = false;
            this.surface = {
                inputRegion: null,
                set_input_region(region) {
                    this.inputRegion = region;
                },
            };
            this.layerShell = {
                anchors: [],
            };
            Gtk.windows.push(this);
        }

        set_child(child) {
            this.child = child;
        }

        realize() {
            this.realized = true;
        }

        get_surface() {
            return this.surface;
        }

        present() {
            this.presented = true;
        }
    };
    const LayerShell = makeLayerShellFake();
    const Gdk = makeGdkFake();
    const cairo = {
        Region: class {
            constructor() {
                this.empty = true;
            }
        },
    };

    const [surface] = LayerShellSurfaces.createWallpaperSurfaces([{id: 'monitor-0'}], {
        Gtk,
        Gdk,
        LayerShell,
        cairo,
        pointerEventsEnabled: false,
    });

    assertEqual(surface.window.realized, false, 'window must not be force-realized for input region');
    assertEqual(surface.window.surface.inputRegion, null, 'input region deferred or skipped until surface exists');
}

[
    testCreatesOneBackgroundSurfacePerMonitor,
    testFallsBackToBottomLayerWhenBackgroundEnumIsUnavailable,
    testEmptyInputRegionDoesNotForceEarlyRealizeWithoutDirectSetter,
].forEach(testCase => testCase());
