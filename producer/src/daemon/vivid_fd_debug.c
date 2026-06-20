#include "vivid_fd_debug.h"

#include <dirent.h>
#include <errno.h>
#include <limits.h>
#include <string.h>
#include <sys/resource.h>
#include <unistd.h>

typedef struct
{
    guint socket;
    guint pipe;
    guint anon_inode_sync_file;
    guint drm_dri;
    guint memfd_dmabuf;
    guint other;
} VividFdDebugCounters;

typedef struct
{
    gchar* log_prefix;
} VividFdDebugContext;

gboolean
vivid_fd_debug_is_enumeration_target(const gchar* target)
{
    if (!target)
        return FALSE;

    if (g_strcmp0(target, "/proc/self/fd") == 0)
        return TRUE;

    gchar* self_fd_path = g_strdup_printf("/proc/%ld/fd", (long)getpid());
    const gboolean matches = g_strcmp0(target, self_fd_path) == 0;
    g_free(self_fd_path);
    return matches;
}

const gchar*
vivid_fd_debug_classify_target(const gchar* target)
{
    if (!target)
        return "other";

    if (g_str_has_prefix(target, "socket:"))
        return "socket";

    if (g_str_has_prefix(target, "pipe:"))
        return "pipe";

    if (g_str_has_prefix(target, "anon_inode:") &&
        (strstr(target, "sync_file") || strstr(target, "sync-file")))
        return "anon_inode_sync_file";

    if (strstr(target, "/dri/") || strstr(target, "/drm/") || strstr(target, "renderD"))
        return "drm_dri";

    if (g_str_has_prefix(target, "/memfd:") ||
        strstr(target, "/memfd:") ||
        strstr(target, "/dmabuf") ||
        strstr(target, "/dma-buf") ||
        strstr(target, "/dma_heap/"))
        return "memfd_dmabuf";

    return "other";
}

static void
increment_counter(VividFdDebugCounters* counters,
                  const gchar*          category)
{
    if (g_strcmp0(category, "socket") == 0)
        counters->socket += 1;
    else if (g_strcmp0(category, "pipe") == 0)
        counters->pipe += 1;
    else if (g_strcmp0(category, "anon_inode_sync_file") == 0)
        counters->anon_inode_sync_file += 1;
    else if (g_strcmp0(category, "drm_dri") == 0)
        counters->drm_dri += 1;
    else if (g_strcmp0(category, "memfd_dmabuf") == 0)
        counters->memfd_dmabuf += 1;
    else
        counters->other += 1;
}

static gboolean
collect_fd_counters(guint*                 out_fd_count,
                    VividFdDebugCounters*   out_counters)
{
    DIR* dir = opendir("/proc/self/fd");
    if (!dir)
        return FALSE;

    struct dirent* entry = NULL;
    guint fd_count = 0;
    VividFdDebugCounters counters = {0};
    gchar link_path[64];
    gchar target[PATH_MAX];

    while ((entry = readdir(dir)) != NULL) {
        if (g_strcmp0(entry->d_name, ".") == 0 ||
            g_strcmp0(entry->d_name, "..") == 0)
            continue;

        g_snprintf(link_path, sizeof(link_path), "/proc/self/fd/%s", entry->d_name);
        const ssize_t len = readlink(link_path, target, sizeof(target) - 1);
        if (len < 0)
            continue;

        target[len] = '\0';
        if (vivid_fd_debug_is_enumeration_target(target))
            continue;

        increment_counter(&counters, vivid_fd_debug_classify_target(target));
        fd_count += 1;
    }

    closedir(dir);
    *out_fd_count = fd_count;
    *out_counters = counters;
    return TRUE;
}

static void
log_fd_debug_sample(const gchar* log_prefix)
{
    guint fd_count = 0;
    VividFdDebugCounters counters = {0};
    if (!collect_fd_counters(&fd_count, &counters)) {
        g_message("%s fd_debug pid=%ld error=proc_fd_unavailable",
                  log_prefix,
                  (long)getpid());
        return;
    }

    struct rlimit limits = {0};
    const gint limit_result = getrlimit(RLIMIT_NOFILE, &limits);
    gchar soft_limit[32];
    gchar hard_limit[32];
    if (limit_result == 0) {
        if (limits.rlim_cur == RLIM_INFINITY)
            g_strlcpy(soft_limit, "unlimited", sizeof(soft_limit));
        else
            g_snprintf(soft_limit, sizeof(soft_limit), "%lu", (gulong)limits.rlim_cur);

        if (limits.rlim_max == RLIM_INFINITY)
            g_strlcpy(hard_limit, "unlimited", sizeof(hard_limit));
        else
            g_snprintf(hard_limit, sizeof(hard_limit), "%lu", (gulong)limits.rlim_max);
    } else {
        g_strlcpy(soft_limit, "unknown", sizeof(soft_limit));
        g_strlcpy(hard_limit, "unknown", sizeof(hard_limit));
    }

    g_message("%s fd_debug pid=%ld fd_count=%u rlimit_nofile=%s/%s socket=%u pipe=%u anon_inode_sync_file=%u drm_dri=%u memfd_dmabuf=%u other=%u",
              log_prefix,
              (long)getpid(),
              fd_count,
              soft_limit,
              hard_limit,
              counters.socket,
              counters.pipe,
              counters.anon_inode_sync_file,
              counters.drm_dri,
              counters.memfd_dmabuf,
              counters.other);
}

static gboolean
fd_debug_timeout(gpointer user_data)
{
    const VividFdDebugContext* context = user_data;
    log_fd_debug_sample(context->log_prefix ? context->log_prefix : "VividProducer:");
    return G_SOURCE_CONTINUE;
}

static void
fd_debug_context_free(gpointer data)
{
    VividFdDebugContext* context = data;
    if (!context)
        return;

    g_free(context->log_prefix);
    g_free(context);
}

gboolean
vivid_fd_debug_enabled(void)
{
    return g_strcmp0(g_getenv("VIVID_FD_DEBUG"), "1") == 0;
}

guint
vivid_fd_debug_start(const gchar* log_prefix)
{
    if (!vivid_fd_debug_enabled())
        return 0;

    VividFdDebugContext* context = g_new0(VividFdDebugContext, 1);
    context->log_prefix = g_strdup(log_prefix ? log_prefix : "VividProducer:");
    return g_timeout_add_seconds_full(G_PRIORITY_DEFAULT,
                                      VIVID_FD_DEBUG_INTERVAL_SECONDS,
                                      fd_debug_timeout,
                                      context,
                                      fd_debug_context_free);
}

void
vivid_fd_debug_stop(guint* source_id)
{
    if (!source_id || *source_id == 0)
        return;

    g_source_remove(*source_id);
    *source_id = 0;
}
