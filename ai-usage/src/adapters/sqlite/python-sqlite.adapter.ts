import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type SqliteQuerySettings = {
  pythonBin: string;
  dbPath: string;
};

export type SqliteQuery = (sql: string, params?: unknown[]) => Promise<Record<string, unknown>[]>;

const SCRIPT = `
import sqlite3, sys, json
db_path, sql = sys.argv[1], sys.argv[2]
params = json.loads(sys.argv[3]) if len(sys.argv) > 3 else []
con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
con.row_factory = sqlite3.Row
rows = [dict(r) for r in con.execute(sql, params)]
sys.stdout.write(json.dumps(rows))
`;

/** Read-only SQLite access through the system python3 (handles WAL files correctly). */
export const createSqliteQuery =
  (settings: SqliteQuerySettings): SqliteQuery =>
  async (sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> => {
    const { stdout } = await execFileAsync(
      settings.pythonBin,
      ["-c", SCRIPT, settings.dbPath, sql, JSON.stringify(params)],
      { maxBuffer: 256 * 1024 * 1024 },
    );
    return JSON.parse(stdout) as Record<string, unknown>[];
  };
