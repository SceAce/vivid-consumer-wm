imports.searchPath.unshift(imports.system.programPath);

const FdDebug = imports.fdDebug;

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

function assertIncludes(actual, expected, message) {
    if (!String(actual).includes(expected)) {
        throw new Error(`${message}: expected "${actual}" to include "${expected}"`);
    }
}

function assertFalse(actual, message) {
    if (actual !== false) {
        throw new Error(`${message}: expected false, got ${actual}`);
    }
}

function assertTrue(actual, message) {
    if (actual !== true) {
        throw new Error(`${message}: expected true, got ${actual}`);
    }
}

function testClassifierBucketsKnownTargets() {
    assertEqual(FdDebug.classifyFdTarget('socket:[1234]'), 'socket', 'socket bucket');
    assertEqual(FdDebug.classifyFdTarget('pipe:[4321]'), 'pipe', 'pipe bucket');
    assertEqual(FdDebug.classifyFdTarget('anon_inode:[sync_file]'), 'anon_inode_sync_file', 'sync_file bucket');
    assertEqual(FdDebug.classifyFdTarget('/dev/dri/renderD128'), 'drm_dri', 'dri bucket');
    assertEqual(FdDebug.classifyFdTarget('/dev/dma_heap/system'), 'memfd_dmabuf', 'dma heap bucket');
    assertEqual(FdDebug.classifyFdTarget('/memfd:vivid-buffer'), 'memfd_dmabuf', 'memfd bucket');
    assertEqual(FdDebug.classifyFdTarget('/tmp/example'), 'other', 'fallback bucket');
}

function testSummarizeFdTargetsCountsBuckets() {
    const summary = FdDebug.summarizeFdTargets([
        'socket:[1]',
        'socket:[2]',
        'pipe:[9]',
        'anon_inode:[sync_file]',
        '/dev/dri/renderD128',
        '/memfd:buffer-1',
        '/tmp/plain-file',
    ]);

    assertDeepEqual(summary, {
        fdCount: 7,
        categories: {
            socket: 2,
            pipe: 1,
            anon_inode_sync_file: 1,
            drm_dri: 1,
            memfd_dmabuf: 1,
            other: 1,
        },
    }, 'bucket summary');
}

function testSummarizeFdTargetsSkipsEnumerationFdTargets() {
    const summary = FdDebug.summarizeFdTargets([
        'socket:[1]',
        '/proc/self/fd',
        `/proc/${4242}/fd`,
        'pipe:[9]',
    ], {pid: 4242});

    assertDeepEqual(summary, {
        fdCount: 2,
        categories: {
            socket: 1,
            pipe: 1,
            anon_inode_sync_file: 0,
            drm_dri: 0,
            memfd_dmabuf: 0,
            other: 0,
        },
    }, 'self enumeration fd excluded');
}

function testEnvGateOnlyEnablesExactOne() {
    assertTrue(FdDebug.isEnabled(name => name === 'VIVID_FD_DEBUG' ? '1' : null), 'exact 1 enables');
    assertFalse(FdDebug.isEnabled(name => name === 'VIVID_FD_DEBUG' ? 'true' : null), 'true does not enable');
    assertFalse(FdDebug.isEnabled(name => name === 'VIVID_FD_DEBUG' ? '01' : null), '01 does not enable');
    assertFalse(FdDebug.isEnabled(name => name === 'VIVID_FD_DEBUG' ? '' : null), 'empty does not enable');
    assertFalse(FdDebug.isEnabled(name => name === 'VIVID_FD_DEBUG' ? null : null), 'unset does not enable');
}

function testReadLimitsParsesRepresentativeProcText() {
    const limits = FdDebug.readLimits({
        readFn() {
            return [true, `Limit                     Soft Limit           Hard Limit           Units
Max cpu time              unlimited            unlimited            seconds
Max open files            1024                 524288               files
Max locked memory         8388608              8388608              bytes
`];
        },
    });

    assertDeepEqual(limits, {
        softLimit: '1024',
        hardLimit: '524288',
    }, 'limits parsed');
}

function testCollectFdDebugSampleSkipsSelfEnumerationFdAndReadFailures() {
    const names = ['3', '4', '5', '6'];
    const targetsByName = {
        '3': 'socket:[11]',
        '4': '/proc/self/fd',
        '5': `/proc/${31337}/fd`,
        '6': 'pipe:[12]',
    };
    const sample = FdDebug.collectFdDebugSample({
        pid: 31337,
        fileFactory() {
            return {
                enumerate_children() {
                    let index = 0;
                    return {
                        next_file() {
                            if (index >= names.length) {
                                return null;
                            }
                            const name = names[index];
                            index += 1;
                            return {
                                get_name() {
                                    return name;
                                },
                            };
                        },
                        close() {},
                    };
                },
            };
        },
        readLinkFn(path) {
            const name = String(path).split('/').pop();
            if (name === '6') {
                throw new Error('transient read failure');
            }
            return targetsByName[name];
        },
        readFn() {
            return [true, 'Max open files            64                   128                  files\n'];
        },
    });

    assertDeepEqual(sample, {
        pid: 31337,
        fdCount: 1,
        softLimit: '64',
        hardLimit: '128',
        categories: {
            socket: 1,
            pipe: 0,
            anon_inode_sync_file: 0,
            drm_dri: 0,
            memfd_dmabuf: 0,
            other: 0,
        },
    }, 'sample excludes self fd and read failures');
}

function testFormatLogLineIncludesPidLimitsAndCounts() {
    const line = FdDebug.formatFdDebugLine({
        pid: 4242,
        fdCount: 9,
        softLimit: 1024,
        hardLimit: 4096,
        categories: {
            socket: 2,
            pipe: 1,
            anon_inode_sync_file: 3,
            drm_dri: 1,
            memfd_dmabuf: 1,
            other: 1,
        },
    });

    assertIncludes(line, 'pid=4242', 'pid included');
    assertIncludes(line, 'fd_count=9', 'fd count included');
    assertIncludes(line, 'rlimit_nofile=1024/4096', 'limits included');
    assertIncludes(line, 'socket=2', 'socket count included');
    assertIncludes(line, 'pipe=1', 'pipe count included');
    assertIncludes(line, 'anon_inode_sync_file=3', 'sync count included');
    assertIncludes(line, 'drm_dri=1', 'dri count included');
    assertIncludes(line, 'memfd_dmabuf=1', 'memfd count included');
    assertIncludes(line, 'other=1', 'other count included');
}

function testMonitorStartStopUsesEnvGateAndTimerHooks() {
    const scheduled = [];
    const removed = [];
    const monitor = new FdDebug.FdDebugMonitor({
        env: name => name === 'VIVID_FD_DEBUG' ? '1' : null,
        timeoutAdd(_priority, intervalMsec, callback) {
            scheduled.push({intervalMsec, callback});
            return 77;
        },
        sourceRemove(id) {
            removed.push(id);
        },
        log() {},
    });

    assertTrue(monitor.start(), 'monitor starts when enabled');
    assertEqual(scheduled.length, 1, 'timer scheduled once');
    assertEqual(scheduled[0].intervalMsec, FdDebug.FD_DEBUG_INTERVAL_MSEC, 'timer interval');
    assertFalse(monitor.start(), 'monitor does not double-start');
    monitor.stop();
    assertDeepEqual(removed, [77], 'timer removed on stop');
}

function testMonitorDoesNotStartWhenEnvDisabled() {
    let scheduled = 0;
    const monitor = new FdDebug.FdDebugMonitor({
        env: () => '0',
        timeoutAdd() {
            scheduled += 1;
            return 1;
        },
        log() {},
    });

    assertFalse(monitor.start(), 'monitor stays disabled');
    assertEqual(scheduled, 0, 'no timer scheduled');
}

[
    testClassifierBucketsKnownTargets,
    testSummarizeFdTargetsCountsBuckets,
    testSummarizeFdTargetsSkipsEnumerationFdTargets,
    testEnvGateOnlyEnablesExactOne,
    testReadLimitsParsesRepresentativeProcText,
    testCollectFdDebugSampleSkipsSelfEnumerationFdAndReadFailures,
    testFormatLogLineIncludesPidLimitsAndCounts,
    testMonitorStartStopUsesEnvGateAndTimerHooks,
    testMonitorDoesNotStartWhenEnvDisabled,
].forEach(testCase => testCase());
