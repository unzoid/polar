// iOS's own alerts, action sheets, menus and share sheet (native_dialogs.rs; src/lib/platform/nativeDialogs.ts).
//
// An alert asks in the middle of the screen; an action sheet rises from the bottom of an iPhone and
// points from the button that opened it on an iPad, as does the share sheet. A menu is a UIMenu at
// the place the web app names (iOS 17.4 and later; before, and if it doesn't show, an action sheet).
// Each dialog answers once, through polar_dialog_done: with the id of the action picked, or with
// nothing when it went away without one (tapped outside on an iPad).

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

/// The app's web view (back.m too).
WKWebView *polar_web_view(void);
WKWebView *polar_web_view(void) { return find_web(polar_app_window()); }

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
/// Another dialog answers for this request now.
@property(nonatomic) BOOL handedOver;
@end

@implementation PolarDialogEnd
- (void)dealloc {
    if (!self.handedOver) polar_dialog_done(self.request, NULL);
}
@end

static char END_KEY;

static NSArray *list(id value) { return [value isKindOfClass:NSArray.class] ? value : @[]; }
static BOOL flag(id value) { return [value isKindOfClass:NSNumber.class] && [value boolValue]; }
/// A menu shown as a sheet needs its way out; a menu itself closes when tapped outside.
static NSArray *with_cancel(NSArray *actions) {
    return [actions arrayByAddingObject:@{@"id" : @"", @"label" : @"Cancel", @"style" : @"cancel"}];
}

/// An action sheet with `actions` (native_dialogs.rs's `Action`s). One with `children` opens a second
/// sheet with them, for the same request. A `checked` one says so with a tick after its label, as a
/// sheet has no checkmarks of its own (menus before iOS 17.4 come this way).
static void present_sheet(UIViewController *from, NSString *title, NSString *message, NSArray *actions, BOOL sheet, id anchor,
                          uint64_t request) {
    UIAlertController *alert =
        [UIAlertController alertControllerWithTitle:title
                                            message:message
                                     preferredStyle:sheet ? UIAlertControllerStyleActionSheet : UIAlertControllerStyleAlert];
    BOOL cancel = NO;
    __weak UIAlertController *weakAlert = alert;
    for (id a in actions) {
        if (![a isKindOfClass:NSDictionary.class]) continue;
        NSString *actionId = string(a[@"id"]), *label = string(a[@"label"]), *style = string(a[@"style"]);
        if (!actionId || !label) continue;
        NSArray *children = list(a[@"children"]);
        if (flag(a[@"checked"])) label = [label stringByAppendingString:@"  \u2713"];
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
                                                handler:^(UIAlertAction *action) {
                                                    if (!children.count) return polar_dialog_done(request, actionId.UTF8String);
                                                    ((PolarDialogEnd *)objc_getAssociatedObject(weakAlert, &END_KEY)).handedOver = YES;
                                                    NSArray *more = with_cancel(children);
                                                    // Shown once this sheet has gone, so it can present.
                                                    dispatch_async(dispatch_get_main_queue(), ^{
                                                        UIViewController *again = presenter();
                                                        if (!again) return polar_dialog_done(request, NULL);
                                                        present_sheet(again, label, nil, more, YES, anchor, request);
                                                    });
                                                }]];
    }
    // Answers "nothing" when it's gone, unless an action answered first; a sheet that opens a second
    // one leaves the answer to that one.
    PolarDialogEnd *end = [PolarDialogEnd new];
    end.request = request;
    objc_setAssociatedObject(alert, &END_KEY, end, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
    if (sheet) point_from(alert.popoverPresentationController, anchor);
    [from presentViewController:alert animated:YES completion:nil];
}

/// A menu's elements: consecutive actions with the same `group` form a section; `children` a submenu.
static NSArray<UIMenuElement *> *menu_elements(NSArray *actions, uint64_t request, BOOL grouped) {
    NSMutableArray<UIMenuElement *> *out = [NSMutableArray array], *section = [NSMutableArray array];
    id group = nil;
    for (id a in actions) {
        if (![a isKindOfClass:NSDictionary.class]) continue;
        NSString *actionId = string(a[@"id"]), *label = string(a[@"label"]), *style = string(a[@"style"]);
        // A menu closes by itself when tapped outside: it has no Cancel.
        if (!actionId || !label || [style isEqualToString:@"cancel"]) continue;
        BOOL same = a[@"group"] == group || [a[@"group"] isEqual:group];
        if (grouped && section.count && !same) {
            [out addObject:[UIMenu menuWithTitle:@"" image:nil identifier:nil options:UIMenuOptionsDisplayInline children:section]];
            section = [NSMutableArray array];
        }
        group = a[@"group"];
        NSArray *children = list(a[@"children"]);
        if (children.count) {
            [section addObject:[UIMenu menuWithTitle:label children:menu_elements(children, request, NO)]];
            continue;
        }
        UIAction *action = [UIAction actionWithTitle:label
                                               image:nil
                                          identifier:nil
                                             handler:^(UIAction *picked) { polar_dialog_done(request, actionId.UTF8String); }];
        if ([style isEqualToString:@"destructive"]) action.attributes = UIMenuElementAttributesDestructive;
        if (flag(a[@"checked"])) action.state = UIMenuElementStateOn;
        [section addObject:action];
    }
    if (!grouped) return section;
    if (section.count) [out addObject:[UIMenu menuWithTitle:@"" image:nil identifier:nil options:UIMenuOptionsDisplayInline children:section]];
    return out;
}

/// The invisible button a menu opens from, laid over the place the web app named. It goes, and the
/// request answers "nothing" if no action did, once the menu has closed.
@interface PolarMenuButton : UIButton
@property(nonatomic) uint64_t request;
@property(nonatomic) BOOL shown;
@end

@implementation PolarMenuButton
- (void)contextMenuInteraction:(UIContextMenuInteraction *)interaction
    willDisplayMenuForConfiguration:(UIContextMenuConfiguration *)configuration
                           animator:(id<UIContextMenuInteractionAnimating>)animator {
    self.shown = YES;
    if ([UIButton instancesRespondToSelector:_cmd])
        [super contextMenuInteraction:interaction willDisplayMenuForConfiguration:configuration animator:animator];
}

- (void)contextMenuInteraction:(UIContextMenuInteraction *)interaction
       willEndForConfiguration:(UIContextMenuConfiguration *)configuration
                      animator:(id<UIContextMenuInteractionAnimating>)animator {
    if ([UIButton instancesRespondToSelector:_cmd])
        [super contextMenuInteraction:interaction willEndForConfiguration:configuration animator:animator];
    uint64_t request = self.request;
    __weak PolarMenuButton *weak = self;
    void (^end)(void) = ^{
        // A picked action's handler runs as the menu closes; give it the first word.
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(300 * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
            [weak removeFromSuperview];
            polar_dialog_done(request, NULL);
        });
    };
    if (animator) [animator addCompletion:end];
    else end();
}
@end

/// iOS 17.4 and later: `d` as a UIMenu from where `d[anchor]` is in the web view. NO where it can't be,
/// and the caller shows an action sheet instead.
static BOOL present_menu(NSDictionary *d, UIViewController *from, uint64_t request) {
    if (@available(iOS 17.4, *)) {
        UIWindow *window = polar_app_window();
        UIView *view = find_web(window) ?: window;
        id rect = d[@"anchor"];
        CGRect at = [rect isKindOfClass:NSDictionary.class]
                        ? CGRectMake(number(rect[@"x"]), number(rect[@"y"]), number(rect[@"width"]), number(rect[@"height"]))
                        : CGRectMake(CGRectGetMidX(view.bounds), CGRectGetMidY(view.bounds), 0, 0);
        // A point (a long press) still needs a button to open from.
        at = CGRectInset(at, MIN(0, (at.size.width - 1) / 2), MIN(0, (at.size.height - 1) / 2));
        PolarMenuButton *button = [PolarMenuButton buttonWithType:UIButtonTypeCustom];
        button.request = request;
        button.frame = at;
        button.isAccessibilityElement = NO;
        button.menu = [UIMenu menuWithTitle:string(d[@"title"]) ?: @"" children:menu_elements(list(d[@"actions"]), request, YES)];
        button.showsMenuAsPrimaryAction = YES;
        [view addSubview:button];
        [button performPrimaryAction];
        // Not shown (the system declined): the sheet instead, for the same request.
        __weak PolarMenuButton *weak = button;
        dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(600 * NSEC_PER_MSEC)), dispatch_get_main_queue(), ^{
            PolarMenuButton *b = weak;
            if (!b || b.shown) return;
            [b removeFromSuperview];
            UIViewController *again = presenter();
            if (!again) return polar_dialog_done(request, NULL);
            present_sheet(again, string(d[@"title"]), string(d[@"message"]), with_cancel(list(d[@"actions"])), YES, d[@"anchor"], request);
        });
        return YES;
    }
    return NO;
}

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
        NSString *kind = string(d[@"kind"]);
        if ([kind isEqualToString:@"menu"] && present_menu(d, from, request)) return;
        NSArray *actions = list(d[@"actions"]);
        if ([kind isEqualToString:@"menu"]) actions = with_cancel(actions);
        present_sheet(from, string(d[@"title"]), string(d[@"message"]), actions, ![kind isEqualToString:@"alert"], d[@"anchor"], request);
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
