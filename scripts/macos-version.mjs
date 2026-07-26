// The one owner of what a release version of this app may look like, and of the
// two numbers macOS reads out of it.
//
// Releases are numbered by date — `YYYY.M.PATCH`, written in SemVer syntax, so
// leading zeroes are illegal and July is `7`. `docs/release-verification.md`
// owns the scheme; this file owns the mapping onto Apple's two fields and is
// the check the release workflow runs before it builds anything.
//
//   CFBundleShortVersionString  the release version, without the prerelease
//   CFBundleVersion             a build number that only ever increases
//
// Apple allows 4 digits in the first component of CFBundleVersion and 2 in each
// of the other two. Every bound below is that constraint read backwards:
//
//   releaseLine  = (year - 2000) * 100 + month   // 2026.7 -> 2607, 4 digits
//   buildVersion = `${releaseLine}.${patch}.${stage + sequence}`
//                  stage: alpha 0 | beta 30 | rc 60 | release 99
//
// macOS compares CFBundleVersion component by component, so the build number
// rises across a prerelease channel (alpha.1 -> beta.1 -> rc.1 -> the release),
// then across patches within a month, then across months, then across years.
// It also clears `1.1.1`, which is what the public 0.0.1-alpha.1 build carries.

const RELEASE_PATTERN =
  /^(\d{4})\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-(alpha|beta|rc)\.(0|[1-9][0-9]*))?$/;

const STAGES = { alpha: 0, beta: 30, rc: 60 };

export function macOSBundleVersions(version) {
  const match = RELEASE_PATTERN.exec(version);
  if (!match) {
    throw new Error(
      `release version must be YYYY.M.PATCH or YYYY.M.PATCH-(alpha|beta|rc).N ` +
        `with no leading zeroes, not ${JSON.stringify(version)}`,
    );
  }
  const [, yearText, monthText, patchText, channel, sequenceText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const patch = Number(patchText);
  const sequence = sequenceText === undefined ? 0 : Number(sequenceText);
  if (year < 2000 || year > 2099) {
    throw new Error(`release year must be 2000-2099, not ${year}`);
  }
  if (month < 1 || month > 12) {
    throw new Error(`release month must be 1-12, not ${month}`);
  }
  if (patch > 99) {
    throw new Error(`release patch must be 0-99, not ${patch}`);
  }
  if (sequence > 29) {
    throw new Error(`prerelease sequence must be 0-29, not ${sequence}`);
  }
  const releaseLine = (year - 2000) * 100 + month;
  const stage = channel === undefined ? 99 : STAGES[channel];
  return {
    appVersion: `${year}.${month}.${patch}`,
    buildVersion: `${releaseLine}.${patch}.${stage + sequence}`,
  };
}
