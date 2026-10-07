import winston from "winston";

const level = process.env.LOG_LEVEL ?? "info";

export const logger: winston.Logger = winston.createLogger({
  level,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(
      (info: winston.Logform.TransformableInfo): string =>
        `${String(info.timestamp)} ${info.level}: ${String(info.message)}${
          Object.keys(info).some((k: string) => !["timestamp", "level", "message"].includes(k))
            ? " " +
              JSON.stringify(
                Object.fromEntries(
                  Object.entries(info).filter(
                    ([k]: [string, unknown]) => !["timestamp", "level", "message"].includes(k),
                  ),
                ),
              )
            : ""
        }`,
    ),
  ),
  transports: [
    new winston.transports.Console({ stderrLevels: ["error", "warn", "info", "debug"] }),
  ],
});
