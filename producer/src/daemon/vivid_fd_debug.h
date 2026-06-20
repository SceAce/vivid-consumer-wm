#pragma once

#include <glib.h>

G_BEGIN_DECLS

#define VIVID_FD_DEBUG_INTERVAL_SECONDS 10u

gboolean vivid_fd_debug_is_enumeration_target(const gchar* target);
const gchar* vivid_fd_debug_classify_target(const gchar* target);
gboolean vivid_fd_debug_enabled(void);
guint vivid_fd_debug_start(const gchar* log_prefix);
void vivid_fd_debug_stop(guint* source_id);

G_END_DECLS
