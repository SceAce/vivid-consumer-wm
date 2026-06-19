#!@gjs@

imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Gdk = '4.0';
imports.gi.versions.Gtk4LayerShell = '1.0';

const LAYER_SHELL_REQUIRED = @layer_shell_required@;

function printUsage() {
    print(`Usage: vivid-consumer-wayland-probe [--help|--probe]

Options:
  --help   Print this help and exit.
  --probe  Initialize GTK and probe Gtk4LayerShell GI bindings.

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

    if (args.length === 1 && args[0] === '--probe') {
        return probeLayerShell();
    }

    printerr(`Unknown arguments: ${args.join(' ')}`);
    printUsage();
    return 2;
}

const exitCode = main(ARGV);
if (exitCode !== 0) {
    imports.system.exit(exitCode);
}
