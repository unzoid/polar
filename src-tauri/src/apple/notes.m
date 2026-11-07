// Notifications on macOS and iOS (notifications/apple.rs; src/lib/platform/notifications.ts), through
// UserNotifications. The centre's delegate is set as the app finishes launching, so a click that
// starts the app is heard too; it shows notes while the app is in front and reports clicks.
//
// macOS only allows this to an app bundle: from a bare binary run from the build folder (`tauri dev`)
// every call answers "denied" and shows nothing.

#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#if TARGET_OS_IPHONE
#import <UIKit/UIKit.h>
#else
#import <AppKit/AppKit.h>
#endif

// notifications/apple.rs
extern void polar_note_clicked(const char *payload);

typedef void (*polar_notes_done)(void *ctx, int status);

// 0 = not asked yet, 1 = granted, 2 = denied (apple.rs).
static int status_of(UNAuthorizationStatus s) {
    switch (s) {
        case UNAuthorizationStatusNotDetermined: return 0;
        case UNAuthorizationStatusDenied: return 2;
        default: return 1;
    }
}

// A dev binary can carry an embedded Info.plist, so its identifier isn't enough: UserNotifications
// throws for anything that isn't an app bundle.
static BOOL bundled(void) {
#if TARGET_OS_IPHONE
    return YES;
#else
    return NSBundle.mainBundle.bundleIdentifier.length > 0 && [NSBundle.mainBundle.bundlePath hasSuffix:@".app"];
#endif
}

@interface PolarNotesDelegate : NSObject <UNUserNotificationCenterDelegate>
@end

@implementation PolarNotesDelegate
- (void)userNotificationCenter:(UNUserNotificationCenter *)center
       willPresentNotification:(UNNotification *)notification
         withCompletionHandler:(void (^)(UNNotificationPresentationOptions))done {
    done(UNNotificationPresentationOptionBanner | UNNotificationPresentationOptionList);
}

- (void)userNotificationCenter:(UNUserNotificationCenter *)center
didReceiveNotificationResponse:(UNNotificationResponse *)response
         withCompletionHandler:(void (^)(void))done {
    if ([response.actionIdentifier isEqualToString:UNNotificationDefaultActionIdentifier]) {
        id payload = response.notification.request.content.userInfo[@"payload"];
        if ([payload isKindOfClass:NSString.class]) polar_note_clicked([payload UTF8String]);
    }
    done();
}
@end

static PolarNotesDelegate *delegate;

static void set_delegate(void) {
    if (delegate || !bundled()) return;
    delegate = [PolarNotesDelegate new];
    UNUserNotificationCenter.currentNotificationCenter.delegate = delegate;
}

// Before the app finishes launching, as UserNotifications asks.
__attribute__((constructor)) static void polar_notes_early(void) {
    @autoreleasepool {
#if TARGET_OS_IPHONE
        NSNotificationName name = UIApplicationDidFinishLaunchingNotification;
#else
        NSNotificationName name = NSApplicationWillFinishLaunchingNotification;
#endif
        [NSNotificationCenter.defaultCenter addObserverForName:name
                                                        object:nil
                                                         queue:nil
                                                    usingBlock:^(NSNotification *n) { set_delegate(); }];
    }
}

void polar_notes_start(void) {
    dispatch_async(dispatch_get_main_queue(), ^{ set_delegate(); });
}

void polar_notes_permission(void *ctx, polar_notes_done done) {
    if (!bundled()) {
        done(ctx, 2);
        return;
    }
    [UNUserNotificationCenter.currentNotificationCenter getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *s) {
        done(ctx, status_of(s.authorizationStatus));
    }];
}

void polar_notes_request(void *ctx, polar_notes_done done) {
    if (!bundled()) {
        done(ctx, 2);
        return;
    }
    UNAuthorizationOptions options = UNAuthorizationOptionAlert | UNAuthorizationOptionSound;
    [UNUserNotificationCenter.currentNotificationCenter requestAuthorizationWithOptions:options
                                                                     completionHandler:^(BOOL granted, NSError *error) {
        done(ctx, granted ? 1 : 2);
    }];
}

static UNNotificationRequest *request_for(NSString *ident, NSString *title, NSString *body, NSString *payload,
                                          UNNotificationTrigger *trigger) {
    UNMutableNotificationContent *content = [UNMutableNotificationContent new];
    content.title = title ?: @"";
    content.body = body ?: @"";
    content.userInfo = @{@"payload" : payload ?: @""};
    content.sound = UNNotificationSound.defaultSound;
    return [UNNotificationRequest requestWithIdentifier:ident content:content trigger:trigger];
}

static NSString *string(const char *s) { return s ? [NSString stringWithUTF8String:s] : nil; }

void polar_notes_show(const char *ident, const char *title, const char *body, const char *payload) {
    if (!bundled() || !ident) return;
    UNNotificationRequest *r = request_for(string(ident), string(title), string(body), string(payload), nil);
    [UNUserNotificationCenter.currentNotificationCenter addNotificationRequest:r withCompletionHandler:nil];
}

// Replaces every planned note with these: a JSON array of {id, title, body, payload, at (ms since 1970)}.
void polar_notes_plan(const char *json) {
    if (!bundled() || !json) return;
    NSData *data = [NSData dataWithBytes:json length:strlen(json)];
    id list = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    UNUserNotificationCenter *center = UNUserNotificationCenter.currentNotificationCenter;
    [center removeAllPendingNotificationRequests];
    if (![list isKindOfClass:NSArray.class]) return;
    NSTimeInterval now = NSDate.date.timeIntervalSince1970;
    for (id n in list) {
        if (![n isKindOfClass:NSDictionary.class]) continue;
        id ident = n[@"id"], title = n[@"title"], body = n[@"body"], payload = n[@"payload"], at = n[@"at"];
        if (![ident isKindOfClass:NSString.class] || ![at isKindOfClass:NSNumber.class]) continue;
        NSTimeInterval wait = [at doubleValue] / 1000.0 - now;
        if (wait < 1) continue;
        UNTimeIntervalNotificationTrigger *trigger = [UNTimeIntervalNotificationTrigger triggerWithTimeInterval:wait repeats:NO];
        NSString *(^text)(id) = ^NSString *(id v) { return [v isKindOfClass:NSString.class] ? v : @""; };
        [center addNotificationRequest:request_for(ident, text(title), text(body), text(payload), trigger) withCompletionHandler:nil];
    }
}
