export type PackageIntent =
  | "local"
  | "developer-build"
  | "release"
  | "development";

export type PackageMode =
  | {
      readonly intent: "local";
      readonly kind: "adhoc";
      readonly productChannel: "release";
    }
  | {
      readonly intent: "developer-build";
      readonly kind: "adhoc";
      readonly productChannel: "preview";
    }
  | {
      readonly intent: "release";
      readonly kind: "signed";
      readonly productChannel: "release";
      readonly channel: "release";
    }
  | {
      readonly intent: "development";
      readonly kind: "signed";
      readonly productChannel: "development";
      readonly channel: "development";
    };

export function resolvePackageMode(value: unknown): PackageMode {
  switch (value) {
    case undefined:
    case "":
    case "local":
      return { intent: "local", kind: "adhoc", productChannel: "release" };
    case "developer-build":
      return {
        intent: "developer-build",
        kind: "adhoc",
        productChannel: "preview",
      };
    case "release":
      return {
        intent: "release",
        kind: "signed",
        productChannel: "release",
        channel: "release",
      };
    case "development":
      return {
        intent: "development",
        kind: "signed",
        productChannel: "development",
        channel: "development",
      };
    default:
      throw new Error(`unknown GW_PACKAGE_INTENT: ${String(value)}`);
  }
}
