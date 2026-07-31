#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>
#import <Security/Security.h>

static NSString *const service = @"io.github.mat4m0.gwonmac.phase0";
static NSString *const account = @"signed-feasibility-probe";

static NSMutableDictionary *query(void) {
  LAContext *context = [[LAContext alloc] init];
  context.interactionNotAllowed = YES;

  return [@{
    (__bridge id)kSecClass : (__bridge id)kSecClassGenericPassword,
    (__bridge id)kSecAttrService : service,
    (__bridge id)kSecAttrAccount : account,
    (__bridge id)kSecUseDataProtectionKeychain : @YES,
    (__bridge id)kSecUseAuthenticationContext : context,
  } mutableCopy];
}

static NSData *payload(NSString *value) {
  return [value dataUsingEncoding:NSUTF8StringEncoding];
}

static int report(NSString *operation, OSStatus status, OSStatus expected) {
  fprintf(stdout, "%s status=%d\n", operation.UTF8String, (int)status);
  if (status == expected) return 0;
  fprintf(stderr, "%s expected=%d actual=%d\n", operation.UTF8String,
          (int)expected, (int)status);
  return 1;
}

static int add(NSString *value) {
  NSMutableDictionary *item = query();
  item[(__bridge id)kSecAttrAccessible] =
      (__bridge id)kSecAttrAccessibleWhenUnlockedThisDeviceOnly;
  item[(__bridge id)kSecValueData] = payload(value);
  return report(@"add", SecItemAdd((__bridge CFDictionaryRef)item, NULL),
                errSecSuccess);
}

static int readExpected(NSString *expected) {
  NSMutableDictionary *item = query();
  item[(__bridge id)kSecReturnData] = @YES;
  item[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;

  CFTypeRef result = NULL;
  OSStatus status =
      SecItemCopyMatching((__bridge CFDictionaryRef)item, &result);
  if (status != errSecSuccess) return report(@"read", status, errSecSuccess);

  NSData *data = CFBridgingRelease(result);
  if (![data isKindOfClass:[NSData class]] || ![data isEqualToData:payload(expected)]) {
    fprintf(stderr, "read returned an unexpected synthetic payload\n");
    return 1;
  }
  return report(@"read", status, errSecSuccess);
}

static int update(NSString *value) {
  NSDictionary *attributes = @{
    (__bridge id)kSecValueData : payload(value),
  };
  return report(
      @"update",
      SecItemUpdate((__bridge CFDictionaryRef)query(),
                    (__bridge CFDictionaryRef)attributes),
      errSecSuccess);
}

static int removeItem(BOOL missingIsSuccess) {
  OSStatus status = SecItemDelete((__bridge CFDictionaryRef)query());
  if (missingIsSuccess && status == errSecItemNotFound) {
    return report(@"delete", status, errSecItemNotFound);
  }
  return report(@"delete", status, errSecSuccess);
}

static int expectInaccessible(void) {
  NSMutableDictionary *item = query();
  item[(__bridge id)kSecReturnData] = @YES;
  item[(__bridge id)kSecMatchLimit] = (__bridge id)kSecMatchLimitOne;

  CFTypeRef result = NULL;
  OSStatus status =
      SecItemCopyMatching((__bridge CFDictionaryRef)item, &result);
  if (result != NULL) CFRelease(result);
  fprintf(stdout, "read-inaccessible status=%d\n", (int)status);
  if (status != errSecSuccess) return 0;
  fprintf(stderr, "an unauthorized or deleted item was unexpectedly readable\n");
  return 1;
}

static void usage(void) {
  fprintf(stderr,
          "usage: keychain-phase0 add-v1|read-v1|update-v2|read-v2|"
          "delete|reset|expect-inaccessible\n");
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 2) {
      usage();
      return 64;
    }

    NSString *operation = [NSString stringWithUTF8String:argv[1]];
    if ([operation isEqualToString:@"add-v1"]) return add(@"phase0-v1");
    if ([operation isEqualToString:@"read-v1"]) return readExpected(@"phase0-v1");
    if ([operation isEqualToString:@"update-v2"]) return update(@"phase0-v2");
    if ([operation isEqualToString:@"read-v2"]) return readExpected(@"phase0-v2");
    if ([operation isEqualToString:@"delete"]) return removeItem(NO);
    if ([operation isEqualToString:@"reset"]) return removeItem(YES);
    if ([operation isEqualToString:@"expect-inaccessible"])
      return expectInaccessible();

    usage();
    return 64;
  }
}
