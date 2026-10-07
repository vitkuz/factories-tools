export interface TerminalClientSettings {
  input: NodeJS.ReadableStream;
  /** Questions are written here — stderr, so stdout stays the command's result. */
  output: NodeJS.WritableStream;
}
