const GLib = imports.gi.GLib;

var SUPPORTED_COMPOSITORS = ['auto', 'generic', 'hyprland', 'niri'];

function defaultRuntimeDir(env = GLib.getenv) {
    return env('XDG_RUNTIME_DIR') || '/tmp';
}

function defaultSocketPath(runtimeDir) {
    return `${runtimeDir}/vivid/display-v1.sock`;
}

function detectCompositor(env = GLib.getenv) {
    return env('HYPRLAND_INSTANCE_SIGNATURE') ? 'hyprland' : 'auto';
}

function parseRuntimeArgs(argv, options = {}) {
    const runtimeDir = options.runtimeDir || defaultRuntimeDir();
    const env = options.env || GLib.getenv;
    let pointerEventsRequested = false;
    let noInputRequested = false;
    const parsed = {
        socketPath: defaultSocketPath(runtimeDir),
        compositor: 'auto',
        pointerEventsRequested: false,
        pointerEventsEnabled: false,
        requiresHyprlandPlugin: false,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const arg = argv[index];

        if (arg === '--socket') {
            index += 1;
            if (index >= argv.length) {
                throw new Error('--socket requires a path');
            }
            parsed.socketPath = argv[index];
        } else if (arg === '--compositor') {
            index += 1;
            if (index >= argv.length) {
                throw new Error('--compositor requires a mode');
            }
            const compositor = argv[index];
            if (!SUPPORTED_COMPOSITORS.includes(compositor)) {
                throw new Error(`Unsupported compositor mode: ${compositor}`);
            }
            parsed.compositor = compositor;
        } else if (arg === '--no-input') {
            noInputRequested = true;
            parsed.pointerEventsEnabled = false;
        } else if (arg === '--enable-pointer-events') {
            pointerEventsRequested = true;
        } else if (arg === '--exit-after-ms') {
            index += 1;
            if (index >= argv.length) {
                throw new Error('--exit-after-ms requires a positive integer');
            }
            const exitAfterMs = Number(argv[index]);
            if (!Number.isInteger(exitAfterMs) || exitAfterMs <= 0) {
                throw new Error('--exit-after-ms requires a positive integer');
            }
            parsed.exitAfterMs = exitAfterMs;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    if (pointerEventsRequested && !noInputRequested && parsed.compositor === 'auto') {
        parsed.compositor = detectCompositor(env);
    }
    parsed.pointerEventsRequested = pointerEventsRequested;
    parsed.pointerEventsEnabled = false;
    parsed.requiresHyprlandPlugin = pointerEventsRequested && !noInputRequested && parsed.compositor === 'hyprland';

    return parsed;
}

var RuntimeArgs = {
    SUPPORTED_COMPOSITORS,
    detectCompositor,
    parseRuntimeArgs,
};
