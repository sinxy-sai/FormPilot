export function createLogger(scope) {
  const prefix = `[FormPilot:${scope}]`;
  const write = (level, message, data) => {
    const fn = console[level] || console.log;
    if (data === undefined) fn(prefix, message);
    else fn(prefix, message, data);
  };
  return Object.freeze({ debug: (message, data) => write('debug', message, data), info: (message, data) => write('info', message, data), warn: (message, data) => write('warn', message, data), error: (message, data) => write('error', message, data) });
}
