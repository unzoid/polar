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

#pragma clang diagnostic ignored "-Wdeprecated-declarations" // OpenGL: deprecated, still what libmpv's render API offers here

#include "../apple/libmpv.h"

static void *gl_proc_address(void *ctx, const char *name) {
    (void)ctx;
    static void *gl;
    if (!gl) gl = dlopen("/System/Library/Frameworks/OpenGL.framework/OpenGL", RTLD_LAZY | RTLD_LOCAL);
    return gl ? dlsym(gl, name) : NULL;
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

// --- Autocrop's frames (the reading itself is in apple/libmpv.h) -----------

/// A client for polar_mpv_frame, or NULL when this libmpv lacks what it needs.
void *polar_mpv_frames_open(void *player) {
    Player *p = player;
    return p ? frames_client(p->mpv) : NULL;
}
