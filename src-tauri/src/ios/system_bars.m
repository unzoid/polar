// The status bar and the home indicator on iOS, while the player is open.
//
// The player hides the status bar (in landscape the clock sat on the video) and
// lets the home indicator fade away until the screen is touched, as video apps
// do; both come back when it closes. iOS asks the window's root view
// controller for these (prefersStatusBarHidden, prefersHomeIndicatorAutoHidden),
// and that controller is Tauri's: its object gets a subclass made here at run
// time that answers from `hidden`, the way key-value observing subclasses an
// object it watches.

#import <UIKit/UIKit.h>
#import <objc/runtime.h>

static BOOL hidden;

static BOOL answer_hidden(id self, SEL _cmd) { return hidden; }
// The root answers itself, rather than handing the question to a child.
static id no_child(id self, SEL _cmd) { return nil; }

static UIViewController *root_controller(void) {
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
        if (![scene isKindOfClass:UIWindowScene.class]) continue;
        UIWindowScene *ws = (UIWindowScene *)scene;
        if (ws.keyWindow.rootViewController) return ws.keyWindow.rootViewController;
        for (UIWindow *w in ws.windows)
            if (w.rootViewController) return w.rootViewController;
    }
    return nil;
}

static void answer(Class sub, Class base, SEL sel, IMP imp) {
    Method m = class_getInstanceMethod(base, sel);
    if (m) class_addMethod(sub, sel, imp, method_getTypeEncoding(m));
}

/// Give `vc` the subclass that answers from `hidden`, once.
static void adopt(UIViewController *vc) {
    Class base = object_getClass(vc);
    const char *prefix = "PolarSystemBars_";
    if (!strncmp(class_getName(base), prefix, strlen(prefix))) return;
    NSString *name = [NSString stringWithFormat:@"%s%s", prefix, class_getName(base)];
    Class sub = NSClassFromString(name);
    if (!sub) {
        sub = objc_allocateClassPair(base, name.UTF8String, 0);
        if (!sub) return;
        answer(sub, base, @selector(prefersStatusBarHidden), (IMP)answer_hidden);
        answer(sub, base, @selector(prefersHomeIndicatorAutoHidden), (IMP)answer_hidden);
        answer(sub, base, @selector(childViewControllerForStatusBarHidden), (IMP)no_child);
        answer(sub, base, @selector(childViewControllerForHomeIndicatorAutoHidden), (IMP)no_child);
        objc_registerClassPair(sub);
    }
    object_setClass(vc, sub);
}

/// Hide (1) or show (0) the status bar and the home indicator. Any thread.
void polar_set_system_bars_hidden(int hide) {
    dispatch_async(dispatch_get_main_queue(), ^{
        hidden = hide != 0;
        // An app that turned view-controller-based status bars off in Info.plist asks the app.
        id perController = [NSBundle.mainBundle objectForInfoDictionaryKey:@"UIViewControllerBasedStatusBarAppearance"];
        if (perController && ![perController boolValue]) {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
            [UIApplication.sharedApplication setStatusBarHidden:hidden withAnimation:UIStatusBarAnimationFade];
#pragma clang diagnostic pop
        }
        UIViewController *vc = root_controller();
        if (!vc) return;
        adopt(vc);
        [UIView animateWithDuration:0.25 animations:^{
            [vc setNeedsStatusBarAppearanceUpdate];
        }];
        [vc setNeedsUpdateOfHomeIndicatorAutoHidden];
    });
}
