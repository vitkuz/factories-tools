// Learned from factories-tools/pipeline-validation/src/features/validate/usecases/validate-pipeline.usecase.ts
import type { FileSystemClient } from '../../../clients/file-system/types.js';
import { PIPELINE_RULES, SETUP_RULES, reportFor, runRules } from '../rules/index.js';
import type { Finding, SetupContext, Severity } from '../rules/index.js';
import { parsePipeline } from './parse-pipeline.service.js';
import type { ParseResult } from './parse-pipeline.service.js';
import { readPipelineFactory } from './read-pipeline.service.js';
import type { ReadResult } from './read-pipeline.service.js';

export const SCHEMA_RULE = 'schema';
export const READ_RULE = 'read';

/** The verdict on one pipeline. `ok` is the gate: no errors. */
export interface ValidationReport {
  ok: boolean;
  /** Absolute path of the pipeline.json. */
  pipeline: string;
  /** False when the shape failed, so the graph rules did not run. */
  rulesRan: boolean;
  findings: Finding[];
}

export const isSeverity =
  (severity: Severity) =>
  (finding: Finding): boolean =>
    finding.severity === severity;

export const messagesOf =
  (severity: Severity) =>
  (findings: readonly Finding[]): string[] =>
    findings.filter(isSeverity(severity)).map((finding: Finding): string => finding.message);

/** Drop repeats of the same severity and message, keeping the first. */
const uniqueFindings = (findings: readonly Finding[]): Finding[] =>
  findings.filter(
    (finding: Finding, index: number): boolean =>
      findings.findIndex(
        (other: Finding): boolean =>
          other.severity === finding.severity && other.message === finding.message,
      ) === index,
  );

const toReport = (
  file: string,
  rulesRan: boolean,
  findings: readonly Finding[],
): ValidationReport => {
  const unique: Finding[] = uniqueFindings(findings);
  return { ok: !unique.some(isSeverity('error')), pipeline: file, rulesRan, findings: unique };
};

/**
 * read → Zod shape → rules. Each stage only runs when the one before it passed; the setup rules
 * always run. Every problem is a finding, never a throw. The same verdict as the kit's validate.mjs.
 */
export const validatePipelineFactory =
  (fileSystem: FileSystemClient) =>
  (setup: Omit<SetupContext, 'fileSystem'>) =>
  (file: string): ValidationReport => {
    const context: SetupContext = { ...setup, fileSystem };
    const setupFindings: Finding[] = runRules(SETUP_RULES)(context);

    const read: ReadResult = readPipelineFactory(fileSystem)(file);
    if (!read.ok) {
      return toReport(file, false, [reportFor(READ_RULE).error(read.error), ...setupFindings]);
    }

    const parsed: ParseResult = parsePipeline(read.document);
    if (!parsed.ok) {
      const schema: Finding[] = parsed.issues.map((issue: string): Finding =>
        reportFor(SCHEMA_RULE).error(`schema: ${issue}`),
      );
      return toReport(file, false, [...schema, ...setupFindings]);
    }

    const ruleFindings: Finding[] = runRules(PIPELINE_RULES)({
      ...context,
      pipeline: parsed.pipeline,
      document: read.document,
      file,
    });
    return toReport(file, true, [...ruleFindings, ...setupFindings]);
  };
