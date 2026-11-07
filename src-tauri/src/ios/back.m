// iOS's own back button (native_back.rs; src/lib/platform/nativeBack.ts).
//
// A system button laid over the web app's Back, where the web app says it stands: Liquid Glass on
// iOS 26 and later, the classic chevron before. A tap goes back one page; a long press opens a menu
// of the pages behind it, as a navigation bar's back button does, and picking one goes back to it.
// The web app hides its own Back while this one shows, and hides this one whenever something covers
// the page (a sheet, a menu, the player).

#import <UIKit/UIKit.h>
#import <WebKit/WebKit.h>

// native_back.rs
extern void polar_back_pressed(uint32_t steps);
// tabs.m, dialogs.m
extern UIWindow *polar_app_window(void);
extern WKWebView *polar_web_view(void);

static UIButton *button;

static double number(id value) { return [value isKindOfClass:NSNumber.class] ? [value doubleValue] : 0; }

static UIButton *make_button(void) {
    UIButtonConfiguration *config;
    if (@available(iOS 26.0, *)) {
        config = [UIButtonConfiguration glassButtonConfiguration];
        config.cornerStyle = UIButtonConfigurationCornerStyleCapsule;
    } else {
        config = [UIButtonConfiguration plainButtonConfiguration];
    }
    UIImageSymbolConfiguration *symbol = [UIImageSymbolConfiguration configurationWithPointSize:17 weight:UIImageSymbolWeightSemibold];
    config.image = [UIImage systemImageNamed:@"chevron.backward" withConfiguration:symbol];
    config.baseForegroundColor = UIColor.labelColor;
    UIButton *b = [UIButton buttonWithConfiguration:config
                                      primaryAction:[UIAction actionWithHandler:^(__kindof UIAction *a) { polar_back_pressed(1); }]];
    b.overrideUserInterfaceStyle = UIUserInterfaceStyleDark;
    b.accessibilityLabel = @"Back";
    b.hidden = YES;
    return b;
}

/// The long-press menu: the pages behind, nearest first, each going back that many steps.
static UIMenu *history_menu(NSArray *history) {
    NSMutableArray<UIAction *> *items = [NSMutableArray array];
    [history enumerateObjectsUsingBlock:^(id title, NSUInteger i, BOOL *stop) {
        if (![title isKindOfClass:NSString.class]) return;
        uint32_t steps = (uint32_t)i + 1;
        [items addObject:[UIAction actionWithTitle:title image:nil identifier:nil handler:^(__kindof UIAction *a) { polar_back_pressed(steps); }]];
    }];
    return items.count ? [UIMenu menuWithChildren:items] : nil;
}

static void apply(NSDictionary *state) {
    UIWindow *window = polar_app_window();
    if (!window) return;
    if (!button) button = make_button();
    // Over the root's view and anything it presents is added later, so alerts and sheets stay on top.
    if (button.superview != window) [window addSubview:button];
    BOOL shown = [state[@"shown"] isKindOfClass:NSNumber.class] && [state[@"shown"] boolValue];
    NSDictionary *rect = [state[@"rect"] isKindOfClass:NSDictionary.class] ? state[@"rect"] : nil;
    if (!shown || !rect) {
        button.hidden = YES;
        return;
    }
    // CSS pixels are the web view's points.
    CGRect frame = CGRectMake(number(rect[@"x"]), number(rect[@"y"]), number(rect[@"width"]), number(rect[@"height"]));
    UIView *web = polar_web_view();
    button.frame = web ? [web convertRect:frame toView:window] : frame;
    NSArray *history = [state[@"history"] isKindOfClass:NSArray.class] ? state[@"history"] : @[];
    button.menu = history_menu(history);
    button.hidden = NO;
}

/// Show, move or hide the button as `json` (native_back.rs's `Back`) says. Any thread.
void polar_back_set(const char *json) {
    NSData *data = [NSData dataWithBytes:json length:strlen(json)];
    dispatch_async(dispatch_get_main_queue(), ^{
        id state = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        if ([state isKindOfClass:NSDictionary.class]) apply(state);
    });
}
