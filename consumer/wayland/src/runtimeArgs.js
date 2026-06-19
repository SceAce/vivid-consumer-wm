const GLib = imports.gi.GLib;

var SUPPORTED_COMPOSITORS = ['auto', 'generic', 'hyprland', 'niri'];

function defaultRuntimeDir(env = GLib.getenv) {
    return env('XDG_RUNTIME_DIR') || '/tmp';
}

function defaultSocketPath(runtimeDir) {
    return `${runtimeDir}/vivid/display-v1.sock`;
}

function parseRuntimeArgs(argv, options = {}) {
    const runtimeDir = options.runtimeDir || defaultRuntimeDir();
    const parsed = {
        socketPath: defaultSocketPath(runtimeDir),
        compositor: 'auto',
        pointerEventsEnabled: false,
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
            parsed.pointerEventsEnabled = false;
        } else if (arg === '--enable-pointer-events') {
            parsed.pointerEventsEnabled = true;
        } else {
            throw new Error(`Unknown argument: ${arg}`);
        }
    }

    return parsed;
}

var RuntimeArgs = {
    SUPPORTED_COMPOSITORS,
    parseRuntimeArgs,
};
