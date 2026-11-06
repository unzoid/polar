// mpv inside the app window on macOS.
//
// On Windows mpv runs as its own process and draws into our window through
// --wid (an HWND works from any process). On macOS --wid takes an NSView*,
// which only means something inside our own process, so a separate mpv just
// opens its own window. Here libmpv runs in-process instead (loaded with
// dlopen, so the app still starts when mpv isn't installed) and draws through
// its render API into a CAOpenGLLayer that sits under the transparent webview.
//
// The rest of the player is unchanged: Rust still talks to this mpv over its
// JSON IPC socket (--input-ipc-server works the same in libmpv).

#import <Cocoa/Cocoa.h>
#import <QuartzCore/QuartzCore.h>
#import <OpenGL/gl3.h>
#import <OpenGL/OpenGL.h>
#include <dlfcn.h>
#include <stdatomic.h>
#include <string.h>

#pragma clang diagnostic ignored "-Wdeprecated-declarations" // OpenGL: deprecated, still what libmpv's render API offers here

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

static void *gl_proc_address(void *ctx, const char *name) {
    (void)ctx;
    static void *gl;
    if (!gl) gl = dlopen("/System/Library/Frameworks/OpenGL.framework/OpenGL", RTLD_LAZY | RTLD_LOCAL);
    return gl ? dlsym(gl, name) : NULL;
}

static void on_main(dispatch_block_t block) {
    if ([NSThread isMainThread]) block();
    else dispatch_sync(dispatch_get_main_queue(), block);
}

// --- The layer mpv draws into -----------------------------------------------

@interface PolarMpvLayer : CAOpenGLLayer
- (instancetype)initWithContext:(CGLContextObj)ctx pixelFormat:(CGLPixelFormatObj)pf render:(mpv_render_context *)rctx;
- (void)invalidate;
@end

@implementation PolarMpvLayer {
    CGLContextObj _ctx;
    CGLPixelFormatObj _pf;
    mpv_render_context *_rctx; // guarded by @synchronized(self)
    atomic_bool _frame;        // mpv has a new frame
    atomic_bool _redraw;       // size or scale changed: draw the last frame again
}

- (instancetype)initWithContext:(CGLContextObj)ctx pixelFormat:(CGLPixelFormatObj)pf render:(mpv_render_context *)rctx {
    if ((self = [super init])) {
        _ctx = CGLRetainContext(ctx);
        _pf = CGLRetainPixelFormat(pf);
        _rctx = rctx;
        atomic_store(&_redraw, true);
        // CA asks canDrawInCGLContext once per display refresh, off the main
        // thread: frames are paced to vsync and don't wait on the UI.
        self.asynchronous = YES;
        self.opaque = YES;
        self.needsDisplayOnBoundsChange = YES;
        self.backgroundColor = NSColor.blackColor.CGColor;
        self.actions = @{ @"bounds": NSNull.null, @"position": NSNull.null, @"contents": NSNull.null };
    }
    return self;
}

- (void)dealloc {
    CGLReleaseContext(_ctx);
    CGLReleasePixelFormat(_pf);
}

- (void)frameReady { atomic_store(&_frame, true); }

- (void)setBounds:(CGRect)bounds { [super setBounds:bounds]; atomic_store(&_redraw, true); }
- (void)setContentsScale:(CGFloat)s { [super setContentsScale:s]; atomic_store(&_redraw, true); }

- (CGLPixelFormatObj)copyCGLPixelFormatForDisplayMask:(uint32_t)mask { return CGLRetainPixelFormat(_pf); }
- (CGLContextObj)copyCGLContextForPixelFormat:(CGLPixelFormatObj)pf { return CGLRetainContext(_ctx); }

- (BOOL)canDrawInCGLContext:(CGLContextObj)ctx pixelFormat:(CGLPixelFormatObj)pf forLayerTime:(CFTimeInterval)t displayTime:(const CVTimeStamp *)ts {
    return atomic_load(&_frame) || atomic_load(&_redraw);
}

- (void)drawInCGLContext:(CGLContextObj)ctx pixelFormat:(CGLPixelFormatObj)pf forLayerTime:(CFTimeInterval)t displayTime:(const CVTimeStamp *)ts {
    atomic_store(&_frame, false);
    atomic_store(&_redraw, false);
    GLint fbo = 0, viewport[4] = {0};
    glGetIntegerv(GL_DRAW_FRAMEBUFFER_BINDING, &fbo);
    glGetIntegerv(GL_VIEWPORT, viewport);
    BOOL drew = NO;
    @synchronized(self) {
        if (_rctx) {
            mpv.render_update(_rctx);
            mpv_opengl_fbo target = { .fbo = fbo, .w = viewport[2], .h = viewport[3], .internal_format = 0 };
            int flip = 1;
            mpv_render_param params[] = {
                { MPV_RENDER_PARAM_OPENGL_FBO, &target },
                { MPV_RENDER_PARAM_FLIP_Y, &flip },
                { MPV_RENDER_PARAM_INVALID, NULL },
            };
            mpv.render_render(_rctx, params);
            drew = YES;
        }
    }
    if (!drew) {
        glClearColor(0, 0, 0, 1);
        glClear(GL_COLOR_BUFFER_BIT);
    }
    [super drawInCGLContext:ctx pixelFormat:pf forLayerTime:t displayTime:ts];
    @synchronized(self) {
        if (_rctx) mpv.render_report_swap(_rctx);
    }
}

/// Free the render context (with its GL context current, as mpv requires).
- (void)invalidate {
    self.asynchronous = NO;
    @synchronized(self) {
        if (!_rctx) return;
        CGLLockContext(_ctx);
        CGLContextObj previous = CGLGetCurrentContext();
        CGLSetCurrentContext(_ctx);
        mpv.render_free(_rctx);
        _rctx = NULL;
        CGLSetCurrentContext(previous);
        CGLUnlockContext(_ctx);
    }
}
@end

static void on_mpv_update(void *layer) {
    [(__bridge PolarMpvLayer *)layer frameReady];
}

// --- The view: under the webview, never takes the mouse ---------------------

@interface PolarMpvView : NSView
@end

@implementation PolarMpvView
- (NSView *)hitTest:(NSPoint)point { return nil; }
- (BOOL)acceptsFirstResponder { return NO; }
- (void)viewDidChangeBackingProperties {
    [super viewDidChangeBackingProperties];
    self.layer.contentsScale = self.window.backingScaleFactor ?: 2.0;
}
@end

// --- What Rust calls --------------------------------------------------------

typedef struct {
    mpv_handle *mpv;
    PolarMpvView *view;   // strong refs held through CFBridgingRetain
    PolarMpvLayer *layer;
} Player;

/// Create mpv in-process with `keys[i]=vals[i]` options and put its video
/// under the content of `nswindow`, hidden until polar_mpv_set_visible.
/// Returns NULL with `err` filled on failure. Safe to call from any thread.
void *polar_mpv_create(const char *libpath, void *nswindow, const char *const *keys, const char *const *vals, int n, char *err, size_t errlen) {
    __block Player *result = NULL;
    on_main(^{
        if (!load_libmpv(libpath, err, errlen)) return;
        mpv_handle *h = mpv.create();
        if (!h) { snprintf(err, errlen, "mpv_create failed"); return; }
        for (int i = 0; i < n; i++) {
            int r = mpv.set_option_string(h, keys[i], vals[i]);
            if (r < 0) NSLog(@"polar: mpv option %s=%s: %s", keys[i], vals[i], mpv.error_string(r));
        }
        int r = mpv.initialize(h);
        if (r < 0) { snprintf(err, errlen, "mpv_initialize: %s", mpv.error_string(r)); mpv.terminate_destroy(h); return; }

        CGLPixelFormatAttribute attrs[] = {
            kCGLPFAOpenGLProfile, (CGLPixelFormatAttribute)kCGLOGLPVersion_3_2_Core,
            kCGLPFADoubleBuffer,
            kCGLPFAAccelerated,
            kCGLPFAAllowOfflineRenderers,
            kCGLPFASupportsAutomaticGraphicsSwitching,
            (CGLPixelFormatAttribute)0,
        };
        CGLPixelFormatObj pf = NULL;
        GLint npix = 0;
        CGLContextObj ctx = NULL;
        if (CGLChoosePixelFormat(attrs, &pf, &npix) != kCGLNoError || !pf || CGLCreateContext(pf, NULL, &ctx) != kCGLNoError) {
            snprintf(err, errlen, "couldn't create an OpenGL context for mpv");
            if (pf) CGLReleasePixelFormat(pf);
            mpv.terminate_destroy(h);
            return;
        }
        GLint swap = 1;
        CGLSetParameter(ctx, kCGLCPSwapInterval, &swap);

        CGLContextObj previous = CGLGetCurrentContext();
        CGLSetCurrentContext(ctx);
        mpv_opengl_init_params gl = { gl_proc_address, NULL };
        mpv_render_param params[] = {
            { MPV_RENDER_PARAM_API_TYPE, (void *)"opengl" },
            { MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl },
            { MPV_RENDER_PARAM_INVALID, NULL },
        };
        mpv_render_context *rctx = NULL;
        r = mpv.render_create(&rctx, h, params);
        CGLSetCurrentContext(previous);
        if (r < 0) {
            snprintf(err, errlen, "mpv_render_context_create: %s", mpv.error_string(r));
            CGLReleaseContext(ctx);
            CGLReleasePixelFormat(pf);
            mpv.terminate_destroy(h);
            return;
        }

        PolarMpvLayer *layer = [[PolarMpvLayer alloc] initWithContext:ctx pixelFormat:pf render:rctx];
        CGLReleaseContext(ctx);
        CGLReleasePixelFormat(pf);
        mpv.render_set_update_callback(rctx, on_mpv_update, (__bridge void *)layer);

        NSWindow *window = (__bridge NSWindow *)nswindow;
        NSView *content = window.contentView;
        PolarMpvView *view = [[PolarMpvView alloc] initWithFrame:content.bounds];
        view.wantsLayer = YES;
        view.layer = layer; // layer-hosting: we own the layer's drawing
        layer.contentsScale = window.backingScaleFactor ?: 2.0;
        view.autoresizingMask = NSViewWidthSizable | NSViewHeightSizable;
        view.hidden = YES;
        // Below every other subview: the webview (transparent while playing) stays on top.
        [content addSubview:view positioned:NSWindowBelow relativeTo:nil];

        Player *p = calloc(1, sizeof(Player));
        p->mpv = h;
        p->view = (__bridge PolarMpvView *)CFBridgingRetain(view);
        p->layer = (__bridge PolarMpvLayer *)CFBridgingRetain(layer);
        result = p;
    });
    return result;
}

/// Show the video (playing) or hide it (idle, so the window's own
/// background shows through wherever the page is transparent).
void polar_mpv_set_visible(void *player, int visible) {
    Player *p = player;
    if (!p) return;
    on_main(^{
        p->view.hidden = !visible;
        if (visible) [p->layer setNeedsDisplay];
    });
}

/// Remove the view and shut mpv down. Safe to call from any thread.
void polar_mpv_destroy(void *player) {
    Player *p = player;
    if (!p) return;
    on_main(^{
        PolarMpvLayer *layer = CFBridgingRelease((__bridge CFTypeRef)p->layer);
        PolarMpvView *view = CFBridgingRelease((__bridge CFTypeRef)p->view);
        [layer invalidate]; // the render context must go before the core
        [view removeFromSuperview];
    });
    mpv_handle *h = p->mpv;
    free(p);
    // Terminating waits for mpv's threads: keep it off the main thread
    // unless that's where we are (app exit, where blocking briefly is fine).
    if ([NSThread isMainThread]) mpv.terminate_destroy(h);
    else dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{ mpv.terminate_destroy(h); });
}

// --- Autocrop's frames (docs/autocrop.md §2) --------------------------------
//
// Our bar detector reads every frame. The frame on screen is zoomed past the
// bars it removed, so it reads mpv's own copy: `screenshot-raw video` hands
// over the decoded frame at its own size, unzoomed and without subtitles, in
// memory (bgr0). Through a weak client of its own, so a read that's still
// running when the player goes away fails instead of touching a freed core.

/// A client for polar_mpv_frame, or NULL when this libmpv lacks what it needs.
void *polar_mpv_frames_open(void *player) {
    Player *p = player;
    if (!p || !mpv.create_weak_client || !mpv.destroy || !mpv.command_ret || !mpv.free_node_contents) return NULL;
    return mpv.create_weak_client(p->mpv, "autocrop");
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
