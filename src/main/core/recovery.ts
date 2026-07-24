function errorCode(error: Error): string {
  return "code" in error ? String(error.code) : "";
}

export function fullDownloadFailureMessage(error: unknown): string {
  let cause = error;
  while (cause instanceof Error) {
    if (["disk_full", "ENOSPC", "EDQUOT"].includes(errorCode(cause))) {
      return "There is not enough free disk space to download the full game. Free some space, then choose Resume Download.";
    }
    cause = cause.cause;
  }
  return "The download could not continue. Check your connection, then choose Resume Download.";
}
