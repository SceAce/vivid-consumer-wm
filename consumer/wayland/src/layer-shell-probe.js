#!@gjs@

imports.gi.versions.Gtk4LayerShell = '1.0';
imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Gdk = '4.0';

imports.searchPath.unshift('@source_dir@');

const GLib = imports.gi.GLib;
const RuntimeArgs = imports.runtimeArgs;
const OutputModel = imports.outputModel;
const LayerShellSurfaces = imports.layerShellSurfaces;

const LAYER_SHELL_REQUIRED = @layer_shell_required@;

function printUsage() {
    print(`Usage: vivid-consumer-wayland-probe [options] [--probe]

Options:
  --help                         Print this help and exit.
  --probe                        Initialize GTK and probe Gtk4LayerShell GI bindings.
  --socket PATH                  Vivid producer socket path.
  --compositor MODE              Compositor mode: ${RuntimeArgs.SUPPORTED_COMPOSITORS.join(', ')}.
  --no-input                     Do not advertise input features.
  --enable-pointer-events        Advertise pointer input support.

This probe does not connect to a Vivid producer socket.`);
}

function importLayerShell() {
    try {
        return imports.gi.Gtk4LayerShell;
    } catch (error) {
        printerr(`Gtk4LayerShell GI import failed: ${error.message}`);
        if (LAYER_SHELL_REQUIRED) {
            printerr('Install the Gtk4LayerShell-1.0 typelib package for runtime probing.');
            return null;
        }

        printerr('Continuing because the Meson probe-only fallback is enabled.');
        return null;
    }
}

function probeLayerShell() {
    const LayerShell = importLayerShell();
    if (LayerShell === null) {
        return LAYER_SHELL_REQUIRED ? 1 : 0;
    }

    const Gtk = imports.gi.Gtk;
    Gtk.init();

    const window = new Gtk.Window({
        title: 'Vivid Wayland Consumer Probe',
        defaultWidth: 1,
        defaultHeight: 1,
    });

    LayerShell.init_for_window(window);
    if (typeof LayerShell.is_layer_window === 'function' &&
        !LayerShell.is_layer_window(window)) {
        printerr('Gtk4LayerShell did not create a layer surface for the probe window.');
        return 1;
    }

    print('Gtk4LayerShell GI bindings imported and initialized.');
    return 0;
}

function collectMonitors(Gdk) {
    const display = Gdk.Display.get_default();
    if (display === null) {
        return [];
    }

    const monitors = display.get_monitors();
    const result = [];
    for (let index = 0; index < monitors.get_n_items(); index += 1) {
        result.push(monitors.get_item(index));
    }

    return result;
}

function runLayerShellConsumer(options) {
    const LayerShell = importLayerShell();
    if (LayerShell === null) {
        return LAYER_SHELL_REQUIRED ? 1 : 0;
    }

    const Gtk = imports.gi.Gtk;
    const Gdk = imports.gi.Gdk;

    Gtk.init();

    const monitors = collectMonitors(Gdk);
    if (monitors.length === 0) {
        printerr('No GDK monitors are available for Wayland layer-shell surfaces.');
        return 1;
    }

    const surfaces = LayerShellSurfaces.createWallpaperSurfaces(monitors, {
        Gtk,
        Gdk,
        LayerShell,
        pointerEventsEnabled: options.pointerEventsEnabled,
    });

    const failedSurface = surfaces.find(surface =>
        typeof LayerShell.is_layer_window === 'function' &&
        !LayerShell.is_layer_window(surface.window));
    if (failedSurface !== undefined) {
        printerr('Gtk4LayerShell did not create a layer surface for a wallpaper window.');
        return 1;
    }

    for (let index = 0; index < monitors.length; index += 1) {
        const output = OutputModel.outputRegistrationFromGdkMonitor(monitors[index], index, {
            compositor: options.compositor,
        });
        print(`Prepared output registration: ${JSON.stringify(output)}`);
    }

    print(`Created ${monitors.length} Wayland layer-shell wallpaper surface(s).`);

    const loop = new GLib.MainLoop(null, false);
    if (options.exitAfterMs !== undefined) {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, options.exitAfterMs, () => {
            loop.quit();
            return GLib.SOURCE_REMOVE;
        });
    }

    loop.run();
    return 0;
}

function main(argv) {
    const args = argv;

    if (args.length === 0 || args.includes('--help') || args.includes('-h')) {
        printUsage();
        return 0;
    }

    const probeIndex = args.indexOf('--probe');
    if (probeIndex !== -1) {
        args.splice(probeIndex, 1);
        RuntimeArgs.parseRuntimeArgs(args);
        return probeLayerShell();
    }

    try {
        const options = RuntimeArgs.parseRuntimeArgs(args);
        return runLayerShellConsumer(options);
    } catch (error) {
        printerr(error.message);
        printUsage();
        return 2;
    }
}

const exitCode = main(ARGV);
imports.system.exit(exitCode);
