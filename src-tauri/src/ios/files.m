// Files on iOS: what the app keeps in its own folders.

#import <Foundation/Foundation.h>

/// Keep `path`, and everything in it, out of iCloud and computer backups.
/// Returns 1 on success.
int polar_exclude_from_backup(const char *path) {
    @autoreleasepool {
        NSURL *url = [NSURL fileURLWithPath:[NSString stringWithUTF8String:path] isDirectory:YES];
        NSError *err = nil;
        if ([url setResourceValue:@YES forKey:NSURLIsExcludedFromBackupKey error:&err]) return 1;
        NSLog(@"polar: excluding from backup: %@", err);
        return 0;
    }
}
