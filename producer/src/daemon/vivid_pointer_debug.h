#pragma once

#include <glib.h>

G_BEGIN_DECLS

gboolean vivid_pointer_debug_enabled(void);
gchar* vivid_pointer_debug_format_motion(guint32 output_id,
                                         gdouble x,
                                         gdouble y,
                                         guint64 time_usec);
void vivid_pointer_debug_log_motion(const gchar* prefix,
                                    guint32 output_id,
                                    gdouble x,
                                    gdouble y,
                                    guint64 time_usec);

G_END_DECLS
