const Gio = imports.gi.Gio;
const GLib = imports.gi.GLib;
const ByteArray = imports.byteArray;
const System = imports.system;

var FD_DEBUG_INTERVAL_MSEC = 10000;

const CATEGORY_ORDER = [
    'socket',
    'pipe',
    'anon_inode_sync_file',
    'drm_dri',
    'memfd_dmabuf',
    'other',
];

function createEmptyCategories() {
    return {
        socket: 0,
        pipe: 0,
        anon_inode_sync_file: 0,
        drm_dri: 0,
        memfd_dmabuf: 0,
        other: 0,
    };
}

function currentPid() {
    return typeof System.getpid === 'function' ? Number(System.getpid()) || 0 : 0;
}

function isEnumerationFdTarget(target, pid = currentPid()) {
    const text = String(target ?? '');
    return text === '/proc/self/fd' ||
        (Number(pid) > 0 && text === `/proc/${Number(pid)}/fd`);
}

function classifyFdTarget(target) {
    const text = String(target ?? '');
    if (text.startsWith('socket:')) {
        return 'socket';
    }
    if (text.startsWith('pipe:')) {
        return 'pipe';
    }
    if (text.startsWith('anon_inode:') &&
        (text.includes('sync_file') || text.includes('sync-file'))) {
        return 'anon_inode_sync_file';
    }
    if (text.includes('/dri/') || text.includes('/drm/') || text.includes('renderD')) {
        return 'drm_dri';
    }
    if (text.startsWith('/memfd:') ||
        text.includes('/memfd:') ||
        text.includes('/dmabuf') ||
        text.includes('/dma_heap/') ||
        text.includes('/dma-buf')) {
        return 'memfd_dmabuf';
    }
    return 'other';
}

function summarizeFdTargets(targets, options = {}) {
    const pid = Number(options.pid ?? currentPid());
    const categories = createEmptyCategories();
    for (const target of Array.isArray(targets) ? targets : []) {
        if (isEnumerationFdTarget(target, pid)) {
            continue;
        }
        categories[classifyFdTarget(target)] += 1;
    }

    const fdCount = CATEGORY_ORDER.reduce((total, category) =>
        total + Number(categories[category] ?? 0), 0);

    return {
        fdCount,
        categories,
    };
}

function formatFdDebugLine(sample) {
    const pid = Number(sample?.pid ?? 0);
    const fdCount = Number(sample?.fdCount ?? 0);
    const softLimit = sample?.softLimit ?? 'unknown';
    const hardLimit = sample?.hardLimit ?? 'unknown';
    const categories = sample?.categories ?? createEmptyCategories();
    const parts = [
        `pid=${pid}`,
        `fd_count=${fdCount}`,
        `rlimit_nofile=${softLimit}/${hardLimit}`,
    ];

    for (const category of CATEGORY_ORDER) {
        parts.push(`${category}=${Number(categories[category] ?? 0)}`);
    }

    return `fd_debug ${parts.join(' ')}`;
}

function isEnabled(env = GLib.getenv) {
    return String(env?.('VIVID_FD_DEBUG') ?? '') === '1';
}

function readFdTargets(options = {}) {
    const fdDirPath = options.fdDirPath || '/proc/self/fd';
    const fileFactory = options.fileFactory || (path => Gio.File.new_for_path(path));
    const readLinkFn = options.readLinkFn || GLib.file_read_link;
    const enumerator = fileFactory(fdDirPath).enumerate_children(
        Gio.FILE_ATTRIBUTE_STANDARD_NAME,
        Gio.FileQueryInfoFlags.NOFOLLOW_SYMLINKS,
        null,
    );
    const targets = [];

    try {
        while (true) {
            const info = enumerator.next_file(null);
            if (!info) {
                break;
            }

            const entryPath = GLib.build_filenamev([fdDirPath, info.get_name()]);
            try {
                const target = readLinkFn(entryPath);
                targets.push(target);
            } catch (_error) {
            }
        }
    } finally {
        enumerator.close?.(null);
    }

    return targets;
}

function readLimits(options = {}) {
    const path = options.path || '/proc/self/limits';
    const readFn = options.readFn || GLib.file_get_contents;
    try {
        const [ok, bytes] = readFn(path);
        if (!ok) {
            return {softLimit: 'unknown', hardLimit: 'unknown'};
        }

        const text = typeof bytes === 'string' ? bytes : ByteArray.toString(bytes);
        const lines = text.split('\n');
        for (const line of lines) {
            if (!line.startsWith('Max open files')) {
                continue;
            }

            const match = line.match(/^Max open files\s+(\S+)\s+(\S+)\s+/);
            if (match) {
                return {
                    softLimit: match[1],
                    hardLimit: match[2],
                };
            }
        }
    } catch (_error) {
    }

    return {softLimit: 'unknown', hardLimit: 'unknown'};
}

function collectFdDebugSample(options = {}) {
    const targets = readFdTargets(options);
    const pid = Number(options.pid ?? currentPid());
    const summary = summarizeFdTargets(targets, {pid});
    const limits = readLimits(options);

    return {
        pid,
        fdCount: summary.fdCount,
        softLimit: limits.softLimit,
        hardLimit: limits.hardLimit,
        categories: summary.categories,
    };
}

function logFdDebugSample(options = {}) {
    const sample = collectFdDebugSample(options);
    const log = options.log || (message => printerr(message));
    log(formatFdDebugLine(sample));
    return sample;
}

var FdDebugMonitor = class FdDebugMonitor {
    constructor(options = {}) {
        this._log = options.log || (message => printerr(`Vivid Wayland Consumer: ${message}`));
        this._intervalMsec = Number(options.intervalMsec ?? FD_DEBUG_INTERVAL_MSEC);
        this._sampleOptions = options.sampleOptions || {};
        this._env = options.env || GLib.getenv;
        this._timeoutAdd = options.timeoutAdd || GLib.timeout_add;
        this._sourceRemove = options.sourceRemove || GLib.source_remove;
        this._sourceId = 0;
    }

    start() {
        if (this._sourceId !== 0 || !isEnabled(this._env)) {
            return false;
        }

        this._sourceId = this._timeoutAdd(GLib.PRIORITY_DEFAULT, this._intervalMsec, () => {
            try {
                logFdDebugSample({
                    ...this._sampleOptions,
                    log: message => this._log(message),
                });
            } catch (error) {
                this._log(`fd_debug error=${error.message ?? error}`);
            }
            return GLib.SOURCE_CONTINUE;
        });
        return true;
    }

    stop() {
        if (this._sourceId === 0) {
            return;
        }

        this._sourceRemove(this._sourceId);
        this._sourceId = 0;
    }
};

var FdDebug = {
    FD_DEBUG_INTERVAL_MSEC,
    classifyFdTarget,
    isEnumerationFdTarget,
    summarizeFdTargets,
    readLimits,
    formatFdDebugLine,
    collectFdDebugSample,
    logFdDebugSample,
    isEnabled,
    FdDebugMonitor,
};
