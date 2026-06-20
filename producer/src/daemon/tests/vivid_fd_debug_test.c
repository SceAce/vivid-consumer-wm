#include "../vivid_fd_debug.h"

#include <assert.h>
#include <unistd.h>

static void
test_classify_fd_target_buckets_known_values(void)
{
    assert(g_strcmp0(vivid_fd_debug_classify_target("socket:[123]"), "socket") == 0);
    assert(g_strcmp0(vivid_fd_debug_classify_target("pipe:[456]"), "pipe") == 0);
    assert(g_strcmp0(vivid_fd_debug_classify_target("anon_inode:[sync_file]"),
                     "anon_inode_sync_file") == 0);
    assert(g_strcmp0(vivid_fd_debug_classify_target("/dev/dri/renderD128"), "drm_dri") == 0);
    assert(g_strcmp0(vivid_fd_debug_classify_target("/memfd:vivid-buffer"), "memfd_dmabuf") == 0);
    assert(g_strcmp0(vivid_fd_debug_classify_target("/tmp/plain-file"), "other") == 0);
}

static void
test_enumeration_fd_target_detection_matches_self_and_pid_paths(void)
{
    gchar* pid_path = g_strdup_printf("/proc/%ld/fd", (long)getpid());
    assert(vivid_fd_debug_is_enumeration_target("/proc/self/fd"));
    assert(vivid_fd_debug_is_enumeration_target(pid_path));
    assert(!vivid_fd_debug_is_enumeration_target("/proc/self/fdinfo"));
    assert(!vivid_fd_debug_is_enumeration_target("/tmp/not-a-proc-fd"));
    g_free(pid_path);
}

int
main(void)
{
    test_classify_fd_target_buckets_known_values();
    test_enumeration_fd_target_detection_matches_self_and_pid_paths();
    return 0;
}
