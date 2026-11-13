export type Logger = {
  info(message: string): void;
  warn(message: string): void;
  error(message: string, error?: unknown): void;
};

const stamp = () => new Date().toISOString();

export const consoleLogger: Logger = {
  info: (message) => console.log(`${stamp()} ${message}`),
  warn: (message) => console.warn(`${stamp()} warning: ${message}`),
  error: (message, error) =>
    console.error(`${stamp()} error: ${message}`, ...(error === undefined ? [] : [error])),
};

export const silentLogger: Logger = { info() {}, warn() {}, error() {} };
