#!/usr/bin/env node
import { Command } from 'commander';
import type { DrawReport, DrawnFile } from '../features/draw/index.js';
import { listPipelineIdsFactory } from '../features/load/index.js';
import {
  directionSchema,
  formatSchema,
  hideableSchema,
  renderOptionsSchema,
  rendererSchema,
  themeSchema,
  viewSchema,
} from '../features/render/render.schema.js';
import type {
  Direction,
  Hideable,
  OutputFormat,
  RendererName,
  Theme,
  View,
} from '../features/render/render.types.js';
import { isAppError } from '../shared/utils/error.utils.js';
import { csvOption, enumOption, listOption, openFile } from './cli.utils.js';
import { createContainer, type Container } from './composition-root.js';

const VERSION = '0.1.0';

interface CliOptions {
  all: boolean;
  list: boolean;
  out?: string;
  format: OutputFormat;
  renderer: RendererName;
  view: View;
  theme: Theme;
  direction: Direction;
  hide: Hideable[];
  highlight: string[];
  root: string;
  open: boolean;
  strict: boolean;
}

const program: Command = new Command()
  .name('factory-diagram')
  .description(
    'Draws a factory pipeline.json as an SVG, headless: ./<id>.svg in the repository root by default.',
  )
  .version(VERSION)
  .argument('[pipeline]', 'a factory id (factories/<id>), its folder, or a pipeline.json')
  .option(
    '--all',
    'every factories/*/pipeline.json, one file each, into ./diagrams (plus index.md)',
    false,
  )
  .option('--list', 'print the available factory ids and exit', false)
  .option('--out <dir|file>', 'a folder to write <id>.svg into, or (one pipeline) the exact file')
  .option(
    '--format <fmt>',
    `svg | json (png, dot, mmd: later)`,
    enumOption('--format', formatSchema),
    'svg',
  )
  .option(
    '--renderer <name>',
    'native (graphviz, mermaid: later)',
    enumOption('--renderer', rendererSchema),
    'native',
  )
  .option(
    '--view <view>',
    'compact (detailed, minimal: later)',
    enumOption('--view', viewSchema),
    'compact',
  )
  .option(
    '--theme <theme>',
    'light (dark, mono: later)',
    enumOption('--theme', themeSchema),
    'light',
  )
  .option(
    '--direction <dir>',
    'LR (TB: graphviz only, later)',
    enumOption('--direction', directionSchema),
    'LR',
  )
  .option(
    '--hide <list>',
    'comma list of loops, max, knowledge, legend, title',
    listOption('--hide', hideableSchema),
    [],
  )
  .option('--highlight <slugs>', 'comma list of step slugs to emphasise', csvOption, [])
  .option('--root <dir>', 'the repository root ({{rootPath}})', process.cwd())
  .option('--open', 'open the result with wslview / xdg-open', false)
  .option('--strict', 'fail on warnings, not only on errors', false)
  .action((pipeline: string | undefined, options: CliOptions): void => {
    const container: Container = createContainer();
    if (options.list) {
      process.stdout.write(
        `${listPipelineIdsFactory(container.fileSystem)(options.root).join('\n')}\n`,
      );
      return;
    }
    const report: DrawReport = container.draw({
      ...(pipeline === undefined ? {} : { pipeline }),
      all: options.all,
      rootPath: options.root,
      ...(options.out === undefined ? {} : { out: options.out }),
      format: options.format,
      strict: options.strict,
      options: renderOptionsSchema.parse({
        renderer: options.renderer,
        view: options.view,
        theme: options.theme,
        direction: options.direction,
        hide: options.hide,
        highlight: options.highlight,
        version: VERSION,
      }),
    });
    report.files.forEach((file: DrawnFile): void => {
      process.stdout.write(`${file.file}\n`);
    });
    if (report.index !== undefined) process.stdout.write(`${report.index}\n`);
    if (options.open) {
      const first: DrawnFile | undefined = report.files[0];
      const opener: string | undefined = first === undefined ? undefined : openFile(first.file);
      if (opener === undefined)
        container.logger.warn(
          'no opener found (wslview, xdg-open, open): open the file above yourself',
        );
    }
  });

/** An error raised on purpose is a message and its issues; anything else keeps its stack. */
const fail = (error: unknown): void => {
  if (!isAppError(error)) throw error;
  process.stderr.write(
    `error: ${error.message}\n${error.issues.map((issue: string): string => `  - ${issue}\n`).join('')}`,
  );
  process.exitCode = 1;
};

try {
  program.parse(process.argv);
} catch (error) {
  fail(error);
}
