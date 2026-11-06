// iOS's own alerts, action sheets and share sheet (native_dialogs.rs; src/lib/platform/nativeDialogs.ts).
//
// An alert asks in the middle of the screen; an action sheet rises from the bottom of an iPhone and
// points from the button that opened it on an iPad, as does the share sheet. Each dialog answers
// once, through polar_dialog_done: with the id of the action picked, or with nothing when it went
// away without one (tapped outside on an iPad).

#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

// native_dialogs.rs
extern void polar_dialog_done(uint64_t request, const char *action);
// tabs.m
extern UIWindow *polar_app_window(void);

static NSString *string(id value) { return [value isKindOfClass:NSString.class] ? value : nil; }
static double number(id value) { return [value isKindOfClass:NSNumber.class] ? [value doubleValue] : 0; }

static NSDictionary *parse(NSData *data) {
    id value = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    return [value isKindOfClass:NSDictionary.class] ? value : nil;
}

static WKWebView *find_web(UIView *view) {
    if ([view isKindOfClass:WKWebView.class]) return (WKWebView *)view;
    for (UIView *sub in view.subviews) {
        WKWebView *web = find_web(sub);
        if (web) return web;
    }
    return nil;
}

/// What presents: the window's root, or whatever it already presents on top.
static UIViewController *presenter(void) {
    UIViewController *vc = polar_app_window().rootViewController;
    while (vc.presentedViewController && !vc.presentedViewController.isBeingDismissed) vc = vc.presentedViewController;
    return vc;
}

/// A popover on an iPad: from `rect` in the web view (CSS pixels are its points), or the screen's middle.
static void point_from(UIPopoverPresentationController *popover, id rect) {
    if (!popover) return;
    UIWindow *window = polar_app_window();
    UIView *view = find_web(window) ?: window;
    popover.sourceView = view;
    if ([rect isKindOfClass:NSDictionary.class]) {
        popover.sourceRect = CGRectMake(number(rect[@"x"]), number(rect[@"y"]), number(rect[@"width"]), number(rect[@"height"]));
    } else {
        popover.sourceRect = CGRectMake(CGRectGetMidX(view.bounds), CGRectGetMidY(view.bounds), 0, 0);
        popover.permittedArrowDirections = 0;
    }
}

/// Goes with a dialog and answers "nothing picked" when it's gone; after an action's answer that
/// one changes nothing (native_dialogs.rs answers each request once).
@interface PolarDialogEnd : NSObject
@property(nonatomic) uint64_t request;
@end

@implementation PolarDialogEnd
- (void)dealloc {
    polar_dialog_done(self.request, NULL);
}
@end

static char END_KEY;

/// Show the dialog described by `json` (native_dialogs.rs's `Dialog`) as `request`. Any thread.
void polar_dialog_show(const char *json, uint64_t request);
void polar_dialog_show(const char *json, uint64_t request) {
    NSData *data = [NSData dataWithBytes:json length:strlen(json)];
    dispatch_async(dispatch_get_main_queue(), ^{
        NSDictionary *d = parse(data);
        UIViewController *from = presenter();
        if (!d || !from) {
            polar_dialog_done(request, NULL);
            return;
        }
        BOOL sheet = [string(d[@"kind"]) isEqualToString:@"sheet"];
        UIAlertController *alert =
            [UIAlertController alertControllerWithTitle:string(d[@"title"])
                                                message:string(d[@"message"])
                                         preferredStyle:sheet ? UIAlertControllerStyleActionSheet : UIAlertControllerStyleAlert];
        BOOL cancel = NO;
        NSArray *actions = [d[@"actions"] isKindOfClass:NSArray.class] ? d[@"actions"] : @[];
        for (id a in actions) {
            if (![a isKindOfClass:NSDictionary.class]) continue;
            NSString *actionId = string(a[@"id"]), *label = string(a[@"label"]), *style = string(a[@"style"]);
            if (!actionId || !label) continue;
            UIAlertActionStyle kind = UIAlertActionStyleDefault;
            // UIKit takes one cancel action at most.
            if ([style isEqualToString:@"cancel"] && !cancel) {
                kind = UIAlertActionStyleCancel;
                cancel = YES;
            } else if ([style isEqualToString:@"destructive"]) {
                kind = UIAlertActionStyleDestructive;
            }
            [alert addAction:[UIAlertAction actionWithTitle:label
                                                      style:kind
                                                    handler:^(UIAlertAction *action) { polar_dialog_done(request, actionId.UTF8String); }]];
        }
        PolarDialogEnd *end = [PolarDialogEnd new];
        end.request = request;
        objc_setAssociatedObject(alert, &END_KEY, end, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
        if (sheet) point_from(alert.popoverPresentationController, d[@"anchor"]);
        [from presentViewController:alert animated:YES completion:nil];
    });
}

/// Open the share sheet with what `json` describes (native_dialogs.rs's `Share`). Any thread.
void polar_share_show(const char *json);
void polar_share_show(const char *json) {
    NSData *data = [NSData dataWithBytes:json length:strlen(json)];
    dispatch_async(dispatch_get_main_queue(), ^{
        NSDictionary *d = parse(data);
        UIViewController *from = presenter();
        NSString *text = string(d[@"text"]);
        if (!text || !from) return;
        NSMutableArray *items = [NSMutableArray arrayWithObject:text];
        NSURL *url = string(d[@"url"]) ? [NSURL URLWithString:string(d[@"url"])] : nil;
        if (url) [items addObject:url];
        UIActivityViewController *share = [[UIActivityViewController alloc] initWithActivityItems:items applicationActivities:nil];
        point_from(share.popoverPresentationController, d[@"anchor"]);
        [from presentViewController:share animated:YES completion:nil];
    });
}
