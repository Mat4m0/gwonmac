export function macOSBundleVersions(version) {
  const match =
    /^(\d+)\.(\d+)\.(\d+)(?:-(alpha|beta|rc)\.(\d+))?$/.exec(version);
  if (!match) {
    throw new Error(
      "release version must be X.Y.Z or X.Y.Z-(alpha|beta|rc).N",
    );
  }
  const [, major, minor, patchText, channel, sequenceText] = match;
  const majorNumber = Number(major);
  const minorNumber = Number(minor);
  const patch = Number(patchText);
  const sequence = sequenceText === undefined ? 0 : Number(sequenceText);
  const releaseLine = majorNumber * 100 + minorNumber + 1;
  if (
    !Number.isSafeInteger(majorNumber) ||
    !Number.isSafeInteger(minorNumber) ||
    !Number.isSafeInteger(patch) ||
    !Number.isSafeInteger(sequence) ||
    releaseLine > 9_999 ||
    minorNumber > 99 ||
    patch > 99 ||
    sequence > 29
  ) {
    throw new Error("release version components are too large");
  }
  const stage = channel === "alpha"
    ? 0
    : channel === "beta"
      ? 30
      : channel === "rc"
        ? 60
        : 99;
  return {
    appVersion: `${major}.${minor}.${patch}`,
    buildVersion: `${releaseLine}.${patch}.${stage + sequence}`,
  };
}
