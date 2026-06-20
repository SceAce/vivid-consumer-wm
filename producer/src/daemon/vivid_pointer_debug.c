#include "vivid_pointer_debug.h"

gboolean
vivid_pointer_debug_enabled(void)
{
    const gchar* value = g_getenv("VIVID_POINTER_DEBUG");
    return value != NULL && g_strcmp0(value, "1") == 0;
}

gchar*
vivid_pointer_debug_format_motion(guint32 output_id,
                                  gdouble x,
                                  gdouble y,
                                  guint64 time_usec)
{
    return g_strdup_printf("pointer motion outputId=%u x=%.6f y=%.6f timeUsec=%" G_GUINT64_FORMAT,
                           output_id,
                           x,
                           y,
                           time_usec);
}

void
vivid_pointer_debug_log_motion(const gchar* prefix,
                               guint32 output_id,
                               gdouble x,
                               gdouble y,
                               guint64 time_usec)
{
    if (!vivid_pointer_debug_enabled())
        return;

    gchar* line = vivid_pointer_debug_format_motion(output_id, x, y, time_usec);
    g_message("%s %s", prefix != NULL ? prefix : "VividProducer:", line);
    g_free(line);
}
