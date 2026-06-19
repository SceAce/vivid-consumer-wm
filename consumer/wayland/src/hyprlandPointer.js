const GLib = imports.gi.GLib;

var DEFAULT_POLL_INTERVAL_MS = 33;

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
        this._timer = options.timer || defaultTimer();
        this._intervalMs = numberOrDefault(options.intervalMs, DEFAULT_POLL_INTERVAL_MS);
        this._monotonicTimeUsec = options.monotonicTimeUsec || defaultMonotonicTimeUsec;
        this._sourceId = 0;
        this._last = null;
        this._jsonFailed = false;
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
        if (!this._jsonFailed) {
            const jsonResult = this._commandRunner('hyprctl cursorpos -j');
            const jsonPosition = jsonResult?.ok ? parseCursorPosition(jsonResult.stdout) : null;
            if (jsonPosition) {
                return jsonPosition;
            }
            this._jsonFailed = true;
        }

        const result = this._commandRunner('hyprctl cursorpos');
        const position = result?.ok ? parseCursorPosition(result.stdout) : null;
        if (!position && result?.stderr) {
            this._logFailureOnce('hyprctl cursorpos', result.stderr);
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
    HyprlandPointerProvider,
    parseCursorPosition,
    outputAtPosition,
};
