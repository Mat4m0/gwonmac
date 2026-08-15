/**
 * Complete host boundary for the one named local Xunlai action.
 * Consumers can ask for availability or request the action and nothing else.
 */
export type StorageCommand = Readonly<{
  open(): void;
  unavailable(): string | null;
}>;
