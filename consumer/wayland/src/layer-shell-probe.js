#!@gjs@

imports.gi.versions.Gtk4LayerShell = '1.0';
imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Gdk = '4.0';

imports.searchPath.unshift('@source_dir@');

const GLib = imports.gi.GLib;
const GIRepository = imports.gi.GIRepository;
const RuntimeArgs = imports.runtimeArgs;
const OutputModel = imports.outputModel;
const LayerShellSurfaces = imports.layerShellSurfaces;
const DisplayConnection = imports.displayConnection;
const RuntimeTopology = imports.runtimeTopology;
const HyprlandPointer = imports.hyprlandPointer;

const LAYER_SHELL_REQUIRED = @layer_shell_required@;
const DISPLAY_CONSUMER_DIR = GLib.getenv('VIVID_DISPLAY_CONSUMER_DIR') || '';

function printUsage() {
    print(`Usage: vivid-consumer-wayland [options] [--probe]

Options:
  --help                         Print this help and exit.
  --probe                        Initialize GTK and probe Gtk4LayerShell GI bindings.
  --socket PATH                  Vivid producer socket path.
  --compositor MODE              Compositor mode: ${RuntimeArgs.SUPPORTED_COMPOSITORS.join(', ')}.
  --no-input                     Do not advertise input features.
  --enable-pointer-events        Forward Hyprland pointer motion without taking input focus.

Normal run connects to the Vivid display-v1 producer socket and presents frames.`);
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

function loadDisplayConsumer() {
    if (DISPLAY_CONSUMER_DIR !== '') {
        const repository = GIRepository.Repository.dup_default();
        repository.prepend_search_path(DISPLAY_CONSUMER_DIR);
        repository.prepend_library_path(DISPLAY_CONSUMER_DIR);
    }

    try {
        return imports.gi.VividDisplayConsumer;
    } catch (error) {
        printerr(`VividDisplayConsumer GI import failed: ${error.message}`);
        printerr('Build the GNOME display consumer library first or set VIVID_DISPLAY_CONSUMER_DIR.');
        return null;
    }
}

function stringFromDisplayConsumer(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function callDisplayConsumerFunction(DisplayConsumer, name, ...args) {
    const fn = DisplayConsumer?.[name];
    if (typeof fn !== 'function') {
        return null;
    }

    try {
        return fn(...args);
    } catch (error) {
        printerr(`VividDisplayConsumer.${name} failed: ${error.message}`);
        return null;
    }
}

function appendUniqueNumber(values, value) {
    if (!values.includes(value)) {
        values.push(value);
    }
}

function buildDmaBufCaps(DisplayConsumer, Gdk) {
    const caps = {
        version: 3,
        backend: 'wayland-gtk4-gdk-dmabuf-texture-builder',
        probe: 'unprobed',
        relayModes: ['direct-import-v1', 'shadow-copy-v1'],
        renderNode: '',
        deviceUuid: '',
        driverUuid: '',
        vendor: '',
        pciAddress: '',
        fourccs: [],
        modifiers: [],
        implicitLinearFourccs: [],
        memoryHints: [],
        syncCaps: ['implicit', 'explicit-sync-fd', 'drm-syncobj-release'],
        colorCaps: ['srgb', 'limited-range', 'premultiplied-alpha'],
        extentMax: {width: 0, height: 0},
        textureTarget: 'GdkDmabufTexture',
        skipsExternalOnlyModifiers: true,
        diagnostics: '',
    };

    try {
        const relayCapsText = stringFromDisplayConsumer(
            callDisplayConsumerFunction(DisplayConsumer, 'dmabuf_texture_query_vulkan_relay_caps_json'));
        if (relayCapsText !== '') {
            const relayCaps = JSON.parse(relayCapsText);
            if (relayCaps?.available && Array.isArray(relayCaps.formats) &&
                relayCaps.formats.length > 0) {
                caps.backend = 'wayland-gtk4-vulkan-dmabuf-relay-gdk-shadow';
                caps.probe = String(relayCaps.probe ?? 'vulkan-relay-format-probe');
                caps.relayModes = ['shadow-copy-v1'];
                caps.renderNode = String(relayCaps.renderNode ?? '');
                caps.deviceUuid = String(relayCaps.deviceUuid ?? '');
                caps.driverUuid = String(relayCaps.driverUuid ?? '');
                caps.memoryHints = relayCaps.supportsDeviceLocal
                    ? ['device-local', 'host-visible']
                    : ['host-visible'];
                caps.textureTarget = 'VulkanRelayShadowGdkDmabufTexture';
                caps.skipsExternalOnlyModifiers = false;
                for (const entry of relayCaps.formats) {
                    appendUniqueNumber(caps.fourccs, Number(entry.fourcc));
                    caps.modifiers.push({
                        fourcc: Number(entry.fourcc),
                        modifier: String(entry.modifier ?? '0'),
                        planeCount: Number(entry.planeCount ?? 1),
                    });
                }
                return caps;
            }
        }
    } catch (error) {
        caps.diagnostics = `vulkan relay caps query failed: ${error.message}`;
    }

    try {
        const display = Gdk.Display.get_default();
        caps.renderNode = stringFromDisplayConsumer(
            callDisplayConsumerFunction(DisplayConsumer, 'dmabuf_texture_get_render_node', display));
        caps.deviceUuid = stringFromDisplayConsumer(
            callDisplayConsumerFunction(DisplayConsumer, 'dmabuf_texture_get_device_uuid', display));
        caps.driverUuid = stringFromDisplayConsumer(
            callDisplayConsumerFunction(DisplayConsumer, 'dmabuf_texture_get_driver_uuid', display));
        caps.vendor = stringFromDisplayConsumer(
            callDisplayConsumerFunction(DisplayConsumer, 'dmabuf_texture_get_vendor', display));
        caps.pciAddress = stringFromDisplayConsumer(
            callDisplayConsumerFunction(DisplayConsumer, 'dmabuf_texture_get_pci_address', display));

        const formats = display?.get_dmabuf_formats?.();
        const nFormats = formats?.get_n_formats?.() ?? 0;
        for (let index = 0; index < nFormats; index += 1) {
            const result = formats.get_format(index);
            const fourcc = Number(Array.isArray(result) ? result[0] : result?.fourcc ?? result?.format ?? 0);
            const modifier = Array.isArray(result) ? result[1] : result?.modifier ?? '0';
            if (!fourcc) {
                continue;
            }

            appendUniqueNumber(caps.fourccs, fourcc);
            caps.modifiers.push({
                fourcc,
                modifier: String(modifier),
                planeCount: 1,
            });
        }

        if (caps.fourccs.length > 0) {
            caps.probe = caps.renderNode
                ? 'gdk-display-dmabuf-formats'
                : 'gdk-display-dmabuf-formats-no-render-node';
            caps.memoryHints = ['host-visible'];
            caps.skipsExternalOnlyModifiers = false;
        } else if (caps.diagnostics === '') {
            caps.probe = 'probe-empty';
            caps.diagnostics = 'GDK display reported no DMA-BUF formats';
        }
    } catch (error) {
        caps.probe = caps.probe === 'unprobed' ? 'probe-failed' : caps.probe;
        caps.diagnostics = `GDK DMA-BUF query failed: ${error.message}`;
    }

    return caps;
}

function runLayerShellConsumer(options) {
    const LayerShell = importLayerShell();
    if (LayerShell === null) {
        return LAYER_SHELL_REQUIRED ? 1 : 0;
    }
    const DisplayConsumer = loadDisplayConsumer();
    if (DisplayConsumer === null) {
        return 1;
    }

    const Gtk = imports.gi.Gtk;
    const Gdk = imports.gi.Gdk;

    Gtk.init();

    const dmabufCaps = buildDmaBufCaps(DisplayConsumer, Gdk);
    print(`Prepared DMA-BUF caps: ${JSON.stringify(dmabufCaps)}`);

    const display = Gdk.Display.get_default();
    let pointerProvider = null;
    const topology = new RuntimeTopology.TopologyController({
        display,
        compositor: options.compositor,
        createSurfaces: monitors => {
            const surfaces = LayerShellSurfaces.createWallpaperSurfaces(monitors, {
                Gtk,
                Gdk,
                LayerShell,
                pointerEventsEnabled: false,
            });
            const failedSurface = surfaces.find(surface =>
                typeof LayerShell.is_layer_window === 'function' &&
                !LayerShell.is_layer_window(surface.window));
            if (failedSurface !== undefined) {
                throw new Error('Gtk4LayerShell did not create a layer surface for a wallpaper window.');
            }
            print(`Created ${monitors.length} Wayland layer-shell wallpaper surface(s).`);
            return surfaces;
        },
        destroySurfaces: surfaces => LayerShellSurfaces.destroyWallpaperSurfaces(surfaces),
        createPresenter: (surface, output) => {
            print(`Prepared output registration: ${JSON.stringify(output)}`);
            return new DisplayConnection.WaylandOutputPresenter(surface, output, {
                DisplayConsumer,
            });
        },
        outputFromMonitor: (monitor, index, outputOptions) =>
            OutputModel.outputRegistrationFromGdkMonitor(monitor, index, outputOptions),
        onPresentersChanged: nextPresenters => pointerProvider?.updateOutputs(nextPresenters),
        log: message => printerr(`Vivid Wayland Consumer: ${message}`),
    });

    let presenters = [];
    try {
        presenters = topology.buildInitial();
    } catch (error) {
        printerr(error.message);
        return 1;
    }

    const displayConnection = new DisplayConnection.DisplaySocketClient({
        socketPath: options.socketPath,
        outputs: presenters,
        pointerEventsEnabled: options.pointerEventsEnabled,
        compositor: options.compositor,
        dmabufCaps,
        DisplayConsumer,
        log: message => printerr(`Vivid Wayland Consumer: ${message}`),
    });
    displayConnection.start();
    topology.watch(displayConnection);

    pointerProvider = options.pointerEventsEnabled && options.compositor === 'hyprland'
        ? new HyprlandPointer.HyprlandPointerProvider({
            outputs: presenters,
            connection: displayConnection,
            log: message => printerr(`Vivid Wayland Consumer: ${message}`),
        })
        : null;
    pointerProvider?.start();

    const loop = new GLib.MainLoop(null, false);
    if (options.exitAfterMs !== undefined) {
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, options.exitAfterMs, () => {
            pointerProvider?.stop();
            topology.stop();
            displayConnection.stop();
            loop.quit();
            return GLib.SOURCE_REMOVE;
        });
    }

    loop.run();
    pointerProvider?.stop();
    topology.stop();
    displayConnection.stop();
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
