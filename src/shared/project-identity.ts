/**
 * The two identifiers that name this project to services outside it: the GitHub
 * repository releases are read from, and the Apple Team ID its bundles are
 * signed under.
 *
 * They live alone, with no imports, because build scripts, the packaging
 * configuration, the updater and the distribution channels all need them and
 * none of those may become the place the others read them from. Changing either
 * changes which releases an installation trusts and which Keychain groups its
 * secrets belong to.
 */
export const RELEASE_REPO = "Mat4m0/gwonmac";
export const APPLE_TEAM_ID = "9NN976MFZ4";
