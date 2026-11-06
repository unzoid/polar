// The app's sections as iOS's own tab bar (native_tabs.rs; src/lib/platform/nativeTabs.ts).
//
// A UITabBarController becomes the window's root, and Tauri's view controller (the web view, with
// the video's view behind it: mpv_view.m) moves into whichever tab is current. One web view serves
// every tab: the web app shows the section the tab bar says, and tells it which one that is. On
// iOS 26 and later the bar is the floating Liquid Glass one, on older iOS the classic one, and on
// an iPad from iOS 18 the tab bar that can turn into a sidebar. The bar is part of the safe area
// the web view sees, so the pages keep clear of it as they keep clear of the home indicator.

#import <UIKit/UIKit.h>

// native_tabs.rs: the user picked the tab `id`, or picked the current one again (back to its top).
extern void polar_tab_chosen(const char *id);

@class PolarTabPage;

@interface PolarTabs : UITabBarController <UITabBarControllerDelegate>
/// Tauri's view controller.
@property(nonatomic, strong) UIViewController *host;
@property(nonatomic, strong) NSMutableDictionary<NSString *, PolarTabPage *> *pages;
/// The tabs as last shown, to leave the bar alone when they haven't changed.
@property(nonatomic, copy) NSString *signature;
/// The tab the web app last said is current: a page that appears as anything else was picked by the user.
@property(nonatomic, copy) NSString *current;
@property(nonatomic) BOOL barHidden;
@property(nonatomic) BOOL sidebarWasShown;
- (void)hostIn:(UIViewController *)page;
- (void)fitHost;
- (void)picked:(NSString *)tabId;
@end

static PolarTabs *controller;

/// One tab's page: empty, but for Tauri's view while it's the one showing.
@interface PolarTabPage : UIViewController
@property(nonatomic, copy) NSString *tabId;
@end

@implementation PolarTabPage

- (void)viewDidLoad {
    [super viewDidLoad];
    self.view.backgroundColor = UIColor.blackColor;
}

- (void)viewWillAppear:(BOOL)animated {
    [super viewWillAppear:animated];
    [controller hostIn:self];
    if (![self.tabId isEqualToString:controller.current]) [controller picked:self.tabId];
}

- (void)viewDidLayoutSubviews {
    [super viewDidLayoutSubviews];
    if (controller.host.parentViewController == self) [controller fitHost];
}

- (void)viewSafeAreaInsetsDidChange {
    [super viewSafeAreaInsetsDidChange];
    if (controller.host.parentViewController == self) [controller fitHost];
}

@end

@implementation PolarTabs

/// Move Tauri's view controller into `page`.
- (void)hostIn:(UIViewController *)page {
    UIViewController *host = self.host;
    if (!host || host.parentViewController == page) return;
    if (host.parentViewController) {
        [host willMoveToParentViewController:nil];
        [host.view removeFromSuperview];
        [host removeFromParentViewController];
    }
    [page addChildViewController:host];
    host.view.frame = page.view.bounds;
    host.view.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
    [page.view addSubview:host.view];
    [host didMoveToParentViewController:page];
    [self fitHost];
}

/// Tauri's view fills its page. With the bar hidden (the player), a page's safe area can still count
/// the bar (iOS before 18 keeps it): that part is taken back out, so the player's controls sit by
/// the home indicator rather than above an empty space.
- (void)fitHost {
    UIViewController *host = self.host;
    UIView *page = host.parentViewController.view;
    if (!page) return;
    host.view.frame = page.bounds;
    CGFloat extra = self.barHidden ? MAX(0, page.safeAreaInsets.bottom - self.view.safeAreaInsets.bottom) : 0;
    UIEdgeInsets insets = host.additionalSafeAreaInsets;
    if (insets.bottom != -extra) {
        insets.bottom = -extra;
        host.additionalSafeAreaInsets = insets;
    }
}

- (void)picked:(NSString *)tabId {
    self.current = tabId;
    polar_tab_chosen(tabId.UTF8String);
}

/// The page showing, also when it's one of those under More (more than five tabs on an iPhone).
- (UIViewController *)shownPage {
    UIViewController *vc = self.selectedViewController;
    if ([vc isKindOfClass:UINavigationController.class]) vc = ((UINavigationController *)vc).topViewController;
    return [vc isKindOfClass:PolarTabPage.class] ? vc : nil;
}

- (void)setItems:(NSArray *)items {
    NSMutableArray<PolarTabPage *> *list = [NSMutableArray array];
    NSMutableString *signature = [NSMutableString string];
    for (id item in items) {
        if (![item isKindOfClass:NSDictionary.class]) continue;
        NSString *tabId = item[@"id"], *title = item[@"title"], *icon = item[@"icon"];
        if (![tabId isKindOfClass:NSString.class] || ![title isKindOfClass:NSString.class] || ![icon isKindOfClass:NSString.class]) continue;
        [signature appendFormat:@"%@\t%@\t%@\n", tabId, title, icon];
        PolarTabPage *page = self.pages[tabId] ?: [PolarTabPage new];
        page.tabId = tabId;
        page.title = title;
        self.pages[tabId] = page;
        UIImage *image = [UIImage systemImageNamed:icon];
        UIImage *selected = [UIImage systemImageNamed:[icon stringByAppendingString:@".fill"]] ?: image;
        page.tabBarItem = [[UITabBarItem alloc] initWithTitle:title image:image selectedImage:selected];
        [list addObject:page];
    }
    if ([signature isEqualToString:self.signature]) return;
    self.signature = signature;
    if (@available(iOS 18.0, *)) {
        NSMutableArray<UITab *> *tabs = [NSMutableArray array];
        for (PolarTabPage *page in list) {
            UITab *tab = [[UITab alloc] initWithTitle:page.title
                                                image:page.tabBarItem.image
                                           identifier:page.tabId
                               viewControllerProvider:^UIViewController *(UITab *t) { return page; }];
            [tabs addObject:tab];
        }
        self.tabs = tabs;
        // An iPad's tab bar can open into a sidebar; an iPhone keeps the bar.
        self.mode = UITabBarControllerModeTabSidebar;
    } else {
        self.viewControllers = list;
    }
}

- (void)select:(NSString *)tabId {
    PolarTabPage *page = self.pages[tabId];
    if (!page) return;
    if (@available(iOS 18.0, *)) {
        UITab *tab = [self tabForIdentifier:tabId];
        if (tab && self.selectedTab != tab) self.selectedTab = tab;
    } else if (self.shownPage != page) {
        self.selectedViewController = page;
    }
}

- (void)setBarHidden:(BOOL)hidden animated:(BOOL)animated {
    if (hidden == self.barHidden) return;
    self.barHidden = hidden;
    if (@available(iOS 18.0, *)) {
        // The sidebar goes with the bar, and comes back if it was open.
        if (hidden) {
            self.sidebarWasShown = !self.sidebar.hidden;
            self.sidebar.hidden = YES;
        } else if (self.sidebarWasShown) {
            self.sidebar.hidden = NO;
        }
        [self setTabBarHidden:hidden animated:animated];
    } else {
        self.tabBar.hidden = hidden;
    }
    [self fitHost];
}

- (void)apply:(NSDictionary *)state {
    NSArray *items = [state[@"tabs"] isKindOfClass:NSArray.class] ? state[@"tabs"] : @[];
    NSString *selected = [state[@"selected"] isKindOfClass:NSString.class] ? state[@"selected"] : nil;
    BOOL hidden = [state[@"hidden"] isKindOfClass:NSNumber.class] && [state[@"hidden"] boolValue];
    if (items.count) [self setItems:items];
    self.current = selected;
    if (selected) [self select:selected];
    [self setBarHidden:hidden || !items.count animated:YES];
    UIViewController *shown = self.shownPage;
    if (shown) [self hostIn:shown];
}

// The current tab picked again: back to its top, as iOS apps do.
- (BOOL)tabBarController:(UITabBarController *)tabs shouldSelectViewController:(UIViewController *)vc {
    if (vc == tabs.selectedViewController && [vc isKindOfClass:PolarTabPage.class]) [self picked:((PolarTabPage *)vc).tabId];
    return YES;
}

- (BOOL)tabBarController:(UITabBarController *)tabs shouldSelectTab:(UITab *)tab API_AVAILABLE(ios(18.0)) {
    if (tab == tabs.selectedTab) [self picked:tab.identifier];
    return YES;
}

@end

static UIWindow *app_window(void) {
    for (UIScene *scene in UIApplication.sharedApplication.connectedScenes) {
        if (![scene isKindOfClass:UIWindowScene.class]) continue;
        UIWindowScene *ws = (UIWindowScene *)scene;
        if (ws.keyWindow.rootViewController) return ws.keyWindow;
        for (UIWindow *w in ws.windows)
            if (w.rootViewController) return w;
    }
    return nil;
}

/// Put the tab bar controller around Tauri's: it takes the window, and Tauri's moves into a tab.
static void install(void) {
    UIWindow *window = app_window();
    UIViewController *host = window.rootViewController;
    if (!host) return;
    PolarTabs *tabs = [PolarTabs new];
    tabs.host = host;
    tabs.pages = [NSMutableDictionary dictionary];
    tabs.delegate = tabs;
    tabs.overrideUserInterfaceStyle = UIUserInterfaceStyleDark;
    tabs.view.backgroundColor = UIColor.blackColor;
    tabs.tabBar.tintColor = UIColor.labelColor;
    controller = tabs;
    window.rootViewController = tabs;
}

/// Show the tabs described by `json` (native_tabs.rs's `Tabs`). Any thread.
void polar_tabs_set(const char *json) {
    NSData *data = [NSData dataWithBytes:json length:strlen(json)];
    dispatch_async(dispatch_get_main_queue(), ^{
        NSDictionary *state = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
        if (![state isKindOfClass:NSDictionary.class]) return;
        if (!controller) {
            NSArray *items = state[@"tabs"];
            if (![items isKindOfClass:NSArray.class] || !items.count) return;
            install();
            if (!controller) return;
        }
        [controller apply:state];
    });
}
