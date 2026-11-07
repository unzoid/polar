// The phone's keychain on iOS (src/keychain.rs): generic passwords under the app id, readable
// after the first unlock and only on this device, so they never go into a backup or to another
// phone.

#import <Foundation/Foundation.h>
#import <Security/Security.h>

static NSMutableDictionary *polar_query(const char *name) {
    return [@{
        (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
        (__bridge id)kSecAttrService : @"app.getpolar.desktop",
        (__bridge id)kSecAttrAccount : [NSString stringWithUTF8String:name],
    } mutableCopy];
}

/// The value under `name` in `*out` (`*len` bytes, freed with `polar_keys_free`).
/// Returns 0 when found, errSecItemNotFound when there is none, else the keychain's status.
int polar_keys_get(const char *name, uint8_t **out, size_t *len) {
    @autoreleasepool {
        NSMutableDictionary *q = polar_query(name);
        q[(__bridge id)kSecReturnData] = @YES;
        q[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;
        CFTypeRef found = NULL;
        OSStatus status = SecItemCopyMatching((__bridge CFDictionaryRef)q, &found);
        if (status != errSecSuccess) return (int)status;
        NSData *data = (__bridge_transfer NSData *)found;
        *len = data.length;
        *out = malloc(data.length > 0 ? data.length : 1);
        if (*out == NULL) return (int)errSecAllocate;
        memcpy(*out, data.bytes, data.length);
        return 0;
    }
}

void polar_keys_free(uint8_t *bytes) { free(bytes); }

/// Keeps `len` bytes under `name`, replacing what was there. Returns the keychain's status.
int polar_keys_set(const char *name, const uint8_t *value, size_t len) {
    @autoreleasepool {
        NSData *data = [NSData dataWithBytes:value length:len];
        NSDictionary *change = @{
            (__bridge id)kSecValueData : data,
            (__bridge id)kSecAttrAccessible : (__bridge id)kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
        };
        OSStatus status = SecItemUpdate((__bridge CFDictionaryRef)polar_query(name), (__bridge CFDictionaryRef)change);
        if (status != errSecItemNotFound) return (int)status;
        NSMutableDictionary *add = polar_query(name);
        [add addEntriesFromDictionary:change];
        return (int)SecItemAdd((__bridge CFDictionaryRef)add, NULL);
    }
}

/// Removes `name`; none there is fine. Returns the keychain's status.
int polar_keys_delete(const char *name) {
    @autoreleasepool {
        OSStatus status = SecItemDelete((__bridge CFDictionaryRef)polar_query(name));
        return status == errSecItemNotFound ? 0 : (int)status;
    }
}
