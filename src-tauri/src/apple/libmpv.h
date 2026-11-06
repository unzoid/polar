// libmpv for the views that draw it inside the app: macos/mpv_view.m and
// ios/mpv_view.m include this once each. libmpv is loaded with dlopen, so the
// app still starts without it; here are the slice of its C API both use,
// loading it, and reading the frames autocrop's detector looks at.

#include <dlfcn.h>
#include <stdatomic.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// --- The slice of libmpv's C API we use (mpv/client.h, render.h, render_gl.h) --

typedef struct mpv_handle mpv_handle;
typedef struct mpv_render_context mpv_render_context;
typedef struct { int type; void *data; } mpv_render_param;
typedef struct { void *(*get_proc_address)(void *ctx, const char *name); void *get_proc_address_ctx; } mpv_opengl_init_params;
typedef struct { int fbo; int w, h; int internal_format; } mpv_opengl_fbo;
enum {
    MPV_RENDER_PARAM_INVALID = 0,
    MPV_RENDER_PARAM_API_TYPE = 1,
    MPV_RENDER_PARAM_OPENGL_INIT_PARAMS = 2,
    MPV_RENDER_PARAM_OPENGL_FBO = 3,
    MPV_RENDER_PARAM_FLIP_Y = 4,
};
#define MPV_RENDER_UPDATE_FRAME 1

// Results of commands (screenshot-raw), from client.h.
typedef struct mpv_node {
    union { char *string; int flag; int64_t int64; double double_; struct mpv_node_list *list; struct mpv_byte_array *ba; } u;
    int format;
} mpv_node;
typedef struct mpv_node_list { int num; mpv_node *values; char **keys; } mpv_node_list;
typedef struct mpv_byte_array { void *data; size_t size; } mpv_byte_array;
enum { MPV_FORMAT_INT64 = 4, MPV_FORMAT_NODE_MAP = 8, MPV_FORMAT_BYTE_ARRAY = 9 };

static struct {
    mpv_handle *(*create)(void);
    int (*set_option_string)(mpv_handle *, const char *, const char *);
    int (*initialize)(mpv_handle *);
    void (*terminate_destroy)(mpv_handle *);
    const char *(*error_string)(int);
    int (*render_create)(mpv_render_context **, mpv_handle *, mpv_render_param *);
    void (*render_set_update_callback)(mpv_render_context *, void (*)(void *), void *);
    uint64_t (*render_update)(mpv_render_context *);
    int (*render_render)(mpv_render_context *, mpv_render_param *);
    void (*render_report_swap)(mpv_render_context *);
    void (*render_free)(mpv_render_context *);
    // Autocrop's frames; optional, so an older libmpv still plays.
    mpv_handle *(*create_weak_client)(mpv_handle *, const char *);
    void (*destroy)(mpv_handle *);
    int (*command_ret)(mpv_handle *, const char **, mpv_node *);
    void (*free_node_contents)(mpv_node *);
} mpv;

static void *libmpv;

static int load_libmpv(const char *path, char *err, size_t errlen) {
    if (libmpv) return 1;
    void *h = dlopen(path, RTLD_NOW | RTLD_LOCAL);
    if (!h) { snprintf(err, errlen, "couldn't load libmpv: %s", dlerror()); return 0; }
#define SYM(field, name) if (!(*(void **)&mpv.field = dlsym(h, name))) { snprintf(err, errlen, "libmpv lacks %s", name); dlclose(h); return 0; }
    SYM(create, "mpv_create")
    SYM(set_option_string, "mpv_set_option_string")
    SYM(initialize, "mpv_initialize")
    SYM(terminate_destroy, "mpv_terminate_destroy")
    SYM(error_string, "mpv_error_string")
    SYM(render_create, "mpv_render_context_create")
    SYM(render_set_update_callback, "mpv_render_context_set_update_callback")
    SYM(render_update, "mpv_render_context_update")
    SYM(render_render, "mpv_render_context_render")
    SYM(render_report_swap, "mpv_render_context_report_swap")
    SYM(render_free, "mpv_render_context_free")
#undef SYM
    *(void **)&mpv.create_weak_client = dlsym(h, "mpv_create_weak_client");
    *(void **)&mpv.destroy = dlsym(h, "mpv_destroy");
    *(void **)&mpv.command_ret = dlsym(h, "mpv_command_ret");
    *(void **)&mpv.free_node_contents = dlsym(h, "mpv_free_node_contents");
    libmpv = h;
    return 1;
}

static void on_main(dispatch_block_t block) {
    if ([NSThread isMainThread]) block();
    else dispatch_sync(dispatch_get_main_queue(), block);
}

// --- Autocrop's frames (docs/autocrop.md §2) --------------------------------
//
// Our bar detector reads every frame. The frame on screen is zoomed past the
// bars it removed, so it reads mpv's own copy: `screenshot-raw video` hands
// over the decoded frame at its own size, unzoomed and without subtitles, in
// memory (bgr0). Through a weak client of its own, so a read that's still
// running when the player goes away fails instead of touching a freed core.

/// A weak client of `h` for polar_mpv_frame, or NULL when this libmpv lacks
/// what it needs (each view's polar_mpv_frames_open calls it with its core).
static void *frames_client(mpv_handle *h) {
    if (!h || !mpv.create_weak_client || !mpv.destroy || !mpv.command_ret || !mpv.free_node_contents) return NULL;
    return mpv.create_weak_client(h, "autocrop");
}

void polar_mpv_frames_close(void *client) {
    if (client) mpv.destroy(client);
}

/// The frame shown now: fills the size, the bytes from one line to the next
/// and the pixels (4 bytes each: blue, green, red, padding), and returns what
/// polar_mpv_frame_free releases; NULL if mpv has no frame. Blocks until mpv
/// has read the frame back: never call it on the main thread.
void *polar_mpv_frame(void *client, int64_t *w, int64_t *h, int64_t *stride, const uint8_t **data, size_t *len) {
    if (!client) return NULL;
    mpv_node *node = calloc(1, sizeof(mpv_node));
    if (!node) return NULL;
    const char *args[] = { "screenshot-raw", "video", NULL };
    if (mpv.command_ret(client, args, node) < 0) { free(node); return NULL; }
    int found = 0;
    if (node->format == MPV_FORMAT_NODE_MAP && node->u.list) {
        for (int i = 0; i < node->u.list->num; i++) {
            const char *key = node->u.list->keys[i];
            mpv_node *v = &node->u.list->values[i];
            if (v->format == MPV_FORMAT_INT64) {
                if (!strcmp(key, "w")) { *w = v->u.int64; found |= 1; }
                else if (!strcmp(key, "h")) { *h = v->u.int64; found |= 2; }
                else if (!strcmp(key, "stride")) { *stride = v->u.int64; found |= 4; }
            } else if (v->format == MPV_FORMAT_BYTE_ARRAY && !strcmp(key, "data") && v->u.ba) {
                *data = v->u.ba->data;
                *len = v->u.ba->size;
                found |= 8;
            }
        }
    }
    if (found != 15) {
        mpv.free_node_contents(node);
        free(node);
        return NULL;
    }
    return node;
}

void polar_mpv_frame_free(void *frame) {
    if (!frame) return;
    mpv.free_node_contents(frame);
    free(frame);
}
