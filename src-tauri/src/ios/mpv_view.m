// mpv inside the app on iOS and iPadOS.
//
// As on macOS (macos/mpv_view.m), libmpv runs in the app's own process,
// loaded with dlopen from the framework scripts/ios-mpv.sh builds (so a build
// without it still starts and plays through the web view's <video>). It draws
// through its render API with OpenGL ES into a view behind the web view; the
// web view stops being opaque, so the page shows the video wherever it is
// transparent, as it does on the desktop.
//
// A CADisplayLink on the main thread asks for a frame each screen refresh;
// drawing runs on a serial queue of its own with the GL context current there.
// iOS ends apps that use OpenGL ES in the background, so drawing stops before
// the app goes there and starts again when it comes back.
//
// Rust drives this mpv over its JSON IPC, through a socket pair it hands over
// as --input-ipc-client (player/mod.rs).

#import <UIKit/UIKit.h>
#import <QuartzCore/QuartzCore.h>
#import <OpenGLES/EAGL.h>
#import <OpenGLES/ES3/gl.h>
#import <AVFoundation/AVFoundation.h>
#import <WebKit/WebKit.h>

#pragma clang diagnostic ignored "-Wdeprecated-declarations" // OpenGL ES: deprecated, still what libmpv's render API offers here

#include "../apple/libmpv.h"

static void *gl_proc_address(void *ctx, const char *name) {
    (void)ctx;
    static void *gl;
    if (!gl) gl = dlopen("/System/Library/Frameworks/OpenGLES.framework/OpenGLES", RTLD_LAZY | RTLD_LOCAL);
    return gl ? dlsym(gl, name) : NULL;
}

// --- The view mpv draws into: behind the web view, never takes a touch -------

@class PolarMpvView;

/// The display link's target: it holds the view weakly, so the link (which
/// retains its target) doesn't keep the view alive.
@interface PolarMpvTick : NSObject
@property (nonatomic, weak) PolarMpvView *view;
@end

@interface PolarMpvView : UIView
- (instancetype)initWithFrame:(CGRect)frame context:(EAGLContext *)ctx render:(mpv_render_context *)rctx;
- (void)frameReady;
- (void)tick;
- (void)setShown:(BOOL)shown;
- (void)invalidate;
@end

@implementation PolarMpvTick
- (void)tick:(CADisplayLink *)link { [self.view tick]; }
@end

@implementation PolarMpvView {
    EAGLContext *_ctx;
    mpv_render_context *_rctx; // used on _queue only
    dispatch_queue_t _queue;
    CADisplayLink *_link;
    GLuint _fbo, _color;       // _queue only
    GLint _w, _h;              // _queue only
    atomic_bool _frame;        // mpv has a new frame
    atomic_bool _redraw;       // size changed or shown again: draw the last frame again
    atomic_bool _resize;       // the layer's size changed: new buffers first
    atomic_bool _drawing;      // a draw is queued or running
    atomic_bool _active;       // the app is in the foreground: GL may be used
}

+ (Class)layerClass { return [CAEAGLLayer class]; }

- (instancetype)initWithFrame:(CGRect)frame context:(EAGLContext *)ctx render:(mpv_render_context *)rctx {
    if ((self = [super initWithFrame:frame])) {
        _ctx = ctx;
        _rctx = rctx;
        _queue = dispatch_queue_create("polarity.mpv-draw", DISPATCH_QUEUE_SERIAL);
        atomic_store(&_resize, true);
        atomic_store(&_redraw, true);
        atomic_store(&_active, UIApplication.sharedApplication.applicationState != UIApplicationStateBackground);
        self.userInteractionEnabled = NO;
        self.opaque = YES;
        self.backgroundColor = UIColor.blackColor;
        self.contentScaleFactor = UIScreen.mainScreen.nativeScale;
        CAEAGLLayer *layer = (CAEAGLLayer *)self.layer;
        layer.opaque = YES;
        layer.drawableProperties = @{
            kEAGLDrawablePropertyRetainedBacking: @NO,
            kEAGLDrawablePropertyColorFormat: kEAGLColorFormatRGBA8,
        };
        PolarMpvTick *tick = [PolarMpvTick new];
        tick.view = self;
        _link = [CADisplayLink displayLinkWithTarget:tick selector:@selector(tick:)];
        _link.paused = YES;
        [_link addToRunLoop:NSRunLoop.mainRunLoop forMode:NSRunLoopCommonModes];
        NSNotificationCenter *nc = NSNotificationCenter.defaultCenter;
        [nc addObserver:self selector:@selector(willBackground) name:UIApplicationDidEnterBackgroundNotification object:nil];
        [nc addObserver:self selector:@selector(willForeground) name:UIApplicationWillEnterForegroundNotification object:nil];
    }
    return self;
}

- (void)frameReady { atomic_store(&_frame, true); }

- (void)layoutSubviews {
    [super layoutSubviews];
    atomic_store(&_resize, true);
    atomic_store(&_redraw, true);
}

/// Going to the background: no GL call may follow, so wait for a draw in flight.
- (void)willBackground {
    atomic_store(&_active, false);
    dispatch_sync(_queue, ^{
        [EAGLContext setCurrentContext:self->_ctx];
        glFinish();
        [EAGLContext setCurrentContext:nil];
    });
}

- (void)willForeground {
    atomic_store(&_active, true);
    atomic_store(&_redraw, true);
}

- (void)setShown:(BOOL)shown {
    self.hidden = !shown;
    _link.paused = !shown;
    if (shown) atomic_store(&_redraw, true);
}

/// Each screen refresh, on the main thread: queue a draw when there's something new.
- (void)tick {
    if (!atomic_load(&_active) || self.hidden) return;
    if (!atomic_load(&_frame) && !atomic_load(&_redraw)) return;
    if (atomic_exchange(&_drawing, true)) return;
    dispatch_async(_queue, ^{
        [self draw];
        atomic_store(&self->_drawing, false);
    });
}

/// (Re)make the framebuffer on the layer's current size. On _queue, context current.
- (void)makeBuffers {
    if (!_fbo) {
        glGenFramebuffers(1, &_fbo);
        glGenRenderbuffers(1, &_color);
    }
    glBindFramebuffer(GL_FRAMEBUFFER, _fbo);
    glBindRenderbuffer(GL_RENDERBUFFER, _color);
    [_ctx renderbufferStorage:GL_RENDERBUFFER fromDrawable:(CAEAGLLayer *)self.layer];
    glFramebufferRenderbuffer(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_RENDERBUFFER, _color);
    glGetRenderbufferParameteriv(GL_RENDERBUFFER, GL_RENDERBUFFER_WIDTH, &_w);
    glGetRenderbufferParameteriv(GL_RENDERBUFFER, GL_RENDERBUFFER_HEIGHT, &_h);
    if (glCheckFramebufferStatus(GL_FRAMEBUFFER) != GL_FRAMEBUFFER_COMPLETE) _w = _h = 0;
}

- (void)draw {
    if (!atomic_load(&_active) || !_rctx) return;
    [EAGLContext setCurrentContext:_ctx];
    if (atomic_exchange(&_resize, false)) [self makeBuffers];
    atomic_store(&_frame, false);
    atomic_store(&_redraw, false);
    if (_w > 0 && _h > 0) {
        mpv.render_update(_rctx);
        glBindFramebuffer(GL_FRAMEBUFFER, _fbo);
        mpv_opengl_fbo target = { .fbo = (int)_fbo, .w = _w, .h = _h, .internal_format = 0 };
        int flip = 1;
        mpv_render_param params[] = {
            { MPV_RENDER_PARAM_OPENGL_FBO, &target },
            { MPV_RENDER_PARAM_FLIP_Y, &flip },
            { MPV_RENDER_PARAM_INVALID, NULL },
        };
        mpv.render_render(_rctx, params);
        glBindRenderbuffer(GL_RENDERBUFFER, _color);
        [_ctx presentRenderbuffer:GL_RENDERBUFFER];
        mpv.render_report_swap(_rctx);
    }
    [EAGLContext setCurrentContext:nil];
}

/// Stop drawing and free the render context (with its GL context current, as
/// mpv requires). On the main thread.
- (void)invalidate {
    [_link invalidate];
    _link = nil;
    [NSNotificationCenter.defaultCenter removeObserver:self];
    dispatch_sync(_queue, ^{
        [EAGLContext setCurrentContext:self->_ctx];
        if (self->_rctx) {
            mpv.render_free(self->_rctx);
            self->_rctx = NULL;
        }
        if (self->_fbo) {
            glDeleteFramebuffers(1, &self->_fbo);
            glDeleteRenderbuffers(1, &self->_color);
            self->_fbo = self->_color = 0;
        }
        glFinish();
        [EAGLContext setCurrentContext:nil];
    });
}
@end

static void on_mpv_update(void *view) {
    [(__bridge PolarMpvView *)view frameReady];
}

// --- What Rust calls (the same functions as on macOS) -----------------------

typedef struct {
    mpv_handle *mpv;
    PolarMpvView *view; // strong ref held through CFBridgingRetain
} Player;

/// Create mpv in-process with `keys[i]=vals[i]` options and put its video
/// behind `webview` (a WKWebView), hidden until polar_mpv_set_visible.
/// Returns NULL with `err` filled on failure. Safe to call from any thread.
void *polar_mpv_create(const char *libpath, void *webview, const char *const *keys, const char *const *vals, int n, char *err, size_t errlen) {
    __block Player *result = NULL;
    on_main(^{
        if (!load_libmpv(libpath, err, errlen)) return;
        WKWebView *web = (__bridge WKWebView *)webview;
        UIView *parent = web.superview;
        if (!parent) { snprintf(err, errlen, "the web view has no superview to put the video in"); return; }

        // Sound plays with the ring/silent switch on silent, as video apps do.
        AVAudioSession *session = AVAudioSession.sharedInstance;
        NSError *audioErr = nil;
        if (![session setCategory:AVAudioSessionCategoryPlayback mode:AVAudioSessionModeMoviePlayback options:0 error:&audioErr]
            || ![session setActive:YES error:&audioErr])
            NSLog(@"polar: audio session: %@", audioErr);

        mpv_handle *h = mpv.create();
        if (!h) { snprintf(err, errlen, "mpv_create failed"); return; }
        for (int i = 0; i < n; i++) {
            int r = mpv.set_option_string(h, keys[i], vals[i]);
            if (r < 0) NSLog(@"polar: mpv option %s: %s", keys[i], mpv.error_string(r));
        }
        int r = mpv.initialize(h);
        if (r < 0) { snprintf(err, errlen, "mpv_initialize: %s", mpv.error_string(r)); mpv.terminate_destroy(h); return; }

        EAGLContext *ctx = [[EAGLContext alloc] initWithAPI:kEAGLRenderingAPIOpenGLES3];
        if (!ctx) {
            snprintf(err, errlen, "couldn't create an OpenGL ES context for mpv");
            mpv.terminate_destroy(h);
            return;
        }
        EAGLContext *previous = EAGLContext.currentContext;
        [EAGLContext setCurrentContext:ctx];
        mpv_opengl_init_params gl = { gl_proc_address, NULL };
        mpv_render_param params[] = {
            { MPV_RENDER_PARAM_API_TYPE, (void *)"opengl" },
            { MPV_RENDER_PARAM_OPENGL_INIT_PARAMS, &gl },
            { MPV_RENDER_PARAM_INVALID, NULL },
        };
        mpv_render_context *rctx = NULL;
        r = mpv.render_create(&rctx, h, params);
        [EAGLContext setCurrentContext:previous];
        if (r < 0) {
            snprintf(err, errlen, "mpv_render_context_create: %s", mpv.error_string(r));
            mpv.terminate_destroy(h);
            return;
        }

        PolarMpvView *view = [[PolarMpvView alloc] initWithFrame:web.frame context:ctx render:rctx];
        mpv.render_set_update_callback(rctx, on_mpv_update, (__bridge void *)view);
        view.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
        view.hidden = YES;
        [parent insertSubview:view belowSubview:web];
        // The page draws its own background where it isn't transparent.
        web.opaque = NO;
        web.backgroundColor = UIColor.clearColor;
        web.scrollView.backgroundColor = UIColor.clearColor;

        Player *p = calloc(1, sizeof(Player));
        p->mpv = h;
        p->view = (__bridge PolarMpvView *)CFBridgingRetain(view);
        result = p;
    });
    return result;
}

/// Show the video (playing) or hide it (idle: nothing is drawn then).
void polar_mpv_set_visible(void *player, int visible) {
    Player *p = player;
    if (!p) return;
    on_main(^{
        [p->view setShown:visible != 0];
    });
}

/// Remove the view and shut mpv down. Safe to call from any thread.
void polar_mpv_destroy(void *player) {
    Player *p = player;
    if (!p) return;
    on_main(^{
        PolarMpvView *view = CFBridgingRelease((__bridge CFTypeRef)p->view);
        [view invalidate]; // the render context must go before the core
        [view removeFromSuperview];
    });
    mpv_handle *h = p->mpv;
    free(p);
    // Terminating waits for mpv's threads: keep it off the main thread
    // unless that's where we are.
    if ([NSThread isMainThread]) mpv.terminate_destroy(h);
    else dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{ mpv.terminate_destroy(h); });
}

// --- Autocrop's frames (the reading itself is in apple/libmpv.h) -----------

/// A client for polar_mpv_frame, or NULL when this libmpv lacks what it needs.
void *polar_mpv_frames_open(void *player) {
    Player *p = player;
    return p ? frames_client(p->mpv) : NULL;
}
