#include "../vivid_pointer_debug.h"

#include <stdio.h>
#include <stdlib.h>

static int
expect_true(gboolean condition, const char* message)
{
    if (condition)
        return 0;

    fprintf(stderr, "FAIL: %s\n", message);
    return 1;
}

static int
test_pointer_debug_gate_follows_environment(void)
{
    unsetenv("VIVID_POINTER_DEBUG");
    if (expect_true(!vivid_pointer_debug_enabled(),
                    "debug should be disabled when VIVID_POINTER_DEBUG is unset") != 0)
        return 1;

    setenv("VIVID_POINTER_DEBUG", "0", 1);
    if (expect_true(!vivid_pointer_debug_enabled(),
                    "debug should be disabled when VIVID_POINTER_DEBUG=0") != 0)
        return 1;

    setenv("VIVID_POINTER_DEBUG", "1", 1);
    if (expect_true(vivid_pointer_debug_enabled(),
                    "debug should be enabled when VIVID_POINTER_DEBUG=1") != 0)
        return 1;

    return 0;
}

static int
test_pointer_motion_formatter_includes_fields(void)
{
    gchar* line = vivid_pointer_debug_format_motion(17u, 12.5, 34.25, 123456789u);
    if (expect_true(line != NULL, "formatter should return a non-null string") != 0)
        return 1;
    if (expect_true(g_strstr_len(line, -1, "outputId=17") != NULL,
                    "formatter should include outputId=17") != 0) {
        g_free(line);
        return 1;
    }
    if (expect_true(g_strstr_len(line, -1, "x=12.500000") != NULL,
                    "formatter should include x=12.500000") != 0) {
        g_free(line);
        return 1;
    }
    if (expect_true(g_strstr_len(line, -1, "y=34.250000") != NULL,
                    "formatter should include y=34.250000") != 0) {
        g_free(line);
        return 1;
    }
    if (expect_true(g_strstr_len(line, -1, "timeUsec=123456789") != NULL,
                    "formatter should include timeUsec=123456789") != 0) {
        g_free(line);
        return 1;
    }
    g_free(line);
    return 0;
}

int
main(void)
{
    if (test_pointer_debug_gate_follows_environment() != 0)
        return 1;
    if (test_pointer_motion_formatter_includes_fields() != 0)
        return 1;
    return 0;
}
