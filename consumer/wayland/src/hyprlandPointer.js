const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;

var DEFAULT_POLL_INTERVAL_MS = 33;
var HYPRLAND_CURSOR_COMMAND = 'j/cursorpos';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function parseCursorPosition(text) {
    const trimmed = String(text ?? '').trim();
    if (trimmed === '') {
        return null;
    }

    try {
        const parsed = JSON.parse(trimmed);
        const x = Number(parsed?.x);
        const y = Number(parsed?.y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
            return {x, y};
        }
    } catch (_error) {
    }

    const match = trimmed.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (!match) {
        return null;
    }

    const x = Number(match[1]);
    const y = Number(match[2]);
    return Number.isFinite(x) && Number.isFinite(y) ? {x, y} : null;
}

function defaultCommandRunner(command) {
    try {
        const [ok, stdout, stderr, status] = GLib.spawn_command_line_sync(command);
        return {
            ok: ok && status === 0,
            stdout: stdout ? new TextDecoder().decode(stdout) : '',
            stderr: stderr ? new TextDecoder().decode(stderr) : '',
            status,
        };
    } catch (error) {
        return {
            ok: false,
            stdout: '',
            stderr: String(error),
            status: -1,
        };
    }
}

function bytesFromGBytes(bytes) {
    const data = bytes.get_data();
    return data instanceof Uint8Array ? data : new Uint8Array(data);
}

function joinByteChunks(chunks, totalLength) {
    const joined = new Uint8Array(totalLength);
    let offset = 0;
    for (const chunk of chunks) {
        joined.set(chunk, offset);
        offset += chunk.length;
    }
    return joined;
}

function defaultHyprlandSocketPath(env = name => GLib.getenv(name)) {
    const runtimeDir = env('XDG_RUNTIME_DIR');
    const signature = env('HYPRLAND_INSTANCE_SIGNATURE');
    if (!runtimeDir || !signature) {
        return null;
    }

    return GLib.build_filenamev([runtimeDir, 'hypr', signature, '.socket.sock']);
}

function readHyprlandIpcCommand(command, options = {}) {
    const socketPath = options.socketPath || defaultHyprlandSocketPath(options.env);
    if (!socketPath) {
        return null;
    }

    let connection = null;
    let input = null;
    let output = null;
    try {
        const client = new Gio.SocketClient();
        connection = client.connect(Gio.UnixSocketAddress.new(socketPath), null);
        input = connection.get_input_stream();
        output = connection.get_output_stream();
        output.write_all(encoder.encode(command), null);
        output.close(null);
        output = null;

        const chunks = [];
        let totalLength = 0;
        while (true) {
            const bytes = input.read_bytes(4096, null);
            if (bytes.get_size() === 0) {
                break;
            }

            const chunk = bytesFromGBytes(bytes);
            chunks.push(chunk);
            totalLength += chunk.length;
        }

        return decoder.decode(joinByteChunks(chunks, totalLength));
    } catch (_error) {
        return null;
    } finally {
        try {
            output?.close?.(null);
        } catch (_error) {
        }
        try {
            input?.close?.(null);
        } catch (_error) {
        }
        try {
            connection?.close?.(null);
        } catch (_error) {
        }
    }
}

function createHyprlandIpcCursorReader(options = {}) {
    const transport = options.transport || (command => readHyprlandIpcCommand(command, options));
    return () => parseCursorPosition(transport(HYPRLAND_CURSOR_COMMAND));
}

function defaultTimer() {
    return {
        add(intervalMs, callback) {
            return GLib.timeout_add(GLib.PRIORITY_DEFAULT, intervalMs, callback);
        },
        remove(sourceId) {
            GLib.source_remove(sourceId);
        },
    };
}

function defaultMonotonicTimeUsec() {
    return GLib.get_monotonic_time();
}

function numberOrDefault(value, defaultValue) {
    const number = Number(value);
    return Number.isFinite(number) ? number : defaultValue;
}

function geometrySource(output) {
    return output?.registration || output || {};
}

function outputAtPosition(outputs, cursorX, cursorY) {
    for (const output of outputs) {
        const geometry = geometrySource(output);
        const x = numberOrDefault(geometry.x, 0);
        const y = numberOrDefault(geometry.y, 0);
        const width = numberOrDefault(geometry.logicalWidth ?? geometry.width, 0);
        const height = numberOrDefault(geometry.logicalHeight ?? geometry.height, 0);
        if (cursorX >= x && cursorX < x + width &&
            cursorY >= y && cursorY < y + height) {
            return {
                output,
                localX: cursorX - x,
                localY: cursorY - y,
            };
        }
    }

    return null;
}

var HyprlandPointerProvider = class HyprlandPointerProvider {
    constructor(options = {}) {
        this._outputs = options.outputs || [];
        this._connection = options.connection;
        this._commandRunner = options.commandRunner || defaultCommandRunner;
        this._ipcCursorReader = options.ipcCursorReader || createHyprlandIpcCursorReader();
        this._timer = options.timer || defaultTimer();
        this._intervalMs = numberOrDefault(options.intervalMs, DEFAULT_POLL_INTERVAL_MS);
        this._monotonicTimeUsec = options.monotonicTimeUsec || defaultMonotonicTimeUsec;
        this._sourceId = 0;
        this._last = null;
        this._fallbackFailed = false;
        this._loggedFailures = new Set();
        this._log = options.log || (_message => {});
    }

    start() {
        if (this._sourceId) {
            return;
        }

        this._sourceId = this._timer.add(this._intervalMs, () => {
            this.pollOnce();
            return GLib.SOURCE_CONTINUE;
        });
    }

    stop() {
        if (!this._sourceId) {
            return;
        }

        this._timer.remove(this._sourceId);
        this._sourceId = 0;
    }

    updateOutputs(outputs) {
        this._outputs = outputs || [];
        this._last = null;
    }

    pollOnce() {
        const position = this._readCursorPosition();
        if (!position) {
            return false;
        }

        const mapped = outputAtPosition(this._outputs, position.x, position.y);
        if (!mapped) {
            this._last = null;
            return false;
        }

        const outputKey = mapped.output.backendOutputId ?? mapped.output.outputId ?? mapped.output.consumerOutputId;
        if (this._last &&
            this._last.outputKey === outputKey &&
            this._last.x === position.x &&
            this._last.y === position.y) {
            return false;
        }

        const sent = this._connection?.queuePointerMotion?.(
            mapped.output,
            mapped.localX,
            mapped.localY,
            this._monotonicTimeUsec(),
        ) === true;
        if (sent) {
            this._last = {
                outputKey,
                x: position.x,
                y: position.y,
            };
        }
        return sent;
    }

    _readCursorPosition() {
        const ipcPosition = this._ipcCursorReader?.(HYPRLAND_CURSOR_COMMAND);
        if (ipcPosition) {
            return ipcPosition;
        }

        if (this._fallbackFailed) {
            return null;
        }

        const result = this._commandRunner('hyprctl cursorpos');
        const position = result?.ok ? parseCursorPosition(result.stdout) : null;
        if (!position) {
            if (result?.stderr) {
                this._logFailureOnce('hyprctl cursorpos', result.stderr);
            }
            this._fallbackFailed = true;
        }
        return position;
    }

    _logFailureOnce(command, stderr) {
        const message = `${command} failed: ${stderr}`;
        if (this._loggedFailures.has(message)) {
            return;
        }

        this._loggedFailures.add(message);
        this._log(message);
    }
};

var HyprlandPointer = {
    DEFAULT_POLL_INTERVAL_MS,
    HYPRLAND_CURSOR_COMMAND,
    HyprlandPointerProvider,
    createHyprlandIpcCursorReader,
    defaultHyprlandSocketPath,
    parseCursorPosition,
    outputAtPosition,
    readHyprlandIpcCommand,
};
