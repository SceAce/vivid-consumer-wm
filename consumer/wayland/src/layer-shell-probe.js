#!@gjs@

imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Gdk = '4.0';
imports.gi.versions.Gtk4LayerShell = '1.0';

imports.searchPath.unshift('@source_dir@');

const RuntimeArgs = imports.runtimeArgs;

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
    const Gtk = imports.gi.Gtk;

    Gtk.init();

    const LayerShell = importLayerShell();
    if (LayerShell === null) {
        return LAYER_SHELL_REQUIRED ? 1 : 0;
    }

    const window = new Gtk.Window({
        title: 'Vivid Wayland Consumer Probe',
        defaultWidth: 1,
        defaultHeight: 1,
    });

    LayerShell.init_for_window(window);
    print('Gtk4LayerShell GI bindings imported and initialized.');
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
        RuntimeArgs.parseRuntimeArgs(args);
        printUsage();
        return 0;
    } catch (error) {
        printerr(error.message);
        printUsage();
        return 2;
    }
}

const exitCode = main(ARGV);
imports.system.exit(exitCode);
