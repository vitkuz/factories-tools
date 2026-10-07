import { useCallback, useEffect, useState } from 'react';
import { describeApiError, isApiError } from '../../../adapters/http/api-error.utils';
import {
  createPipeline,
  listPipelines,
  readPipeline,
  savePipeline,
} from '../../../adapters/http/studio-api.adapter';
import { parsePipeline, type ParseResult } from '../lib/pipeline.schema';
import type { Created, ListState, PipelineListEntry, Saved } from '../editor.types';

export interface PipelineSource {
  entries: PipelineListEntry[];
  listState: ListState;
  listError: string | null;
  /** The file of one skill, parsed. A parse failure is a value (`ok: false`); an API failure throws an `ApiError`. */
  load: (id: string, signal?: AbortSignal) => Promise<ParseResult>;
  /** The file of one skill as text (for references). Throws an `ApiError` on failure. */
  readText: (id: string) => Promise<string>;
  /** Write the serialised pipeline back. Throws an `ApiError` on refusal. */
  save: (id: string, text: string) => Promise<Saved>;
  /** Create `factories/<id>/pipeline.json` and its wrapper skill from the serialised pipeline. Throws an `ApiError` on refusal. */
  create: (text: string) => Promise<Created>;
  reloadList: () => void;
}

const messageOf = (error: unknown): string =>
  isApiError(error)
    ? describeApiError(error)
    : error instanceof Error
      ? error.message
      : String(error);

/** Where pipelines come from: the API's list, one file per id, and the write back. */
export const usePipelineSource = (): PipelineSource => {
  const [entries, setEntries] = useState<PipelineListEntry[]>([]);
  const [listState, setListState] = useState<ListState>('loading');
  const [listError, setListError] = useState<string | null>(null);
  const [listTick, setListTick] = useState<number>(0);

  useEffect(() => {
    const controller: AbortController = new AbortController();
    setListState('loading');
    listPipelines(controller.signal)
      .then((list): void => {
        if (controller.signal.aborted) return;
        setEntries(list.pipelines);
        setListError(null);
        setListState('ready');
      })
      .catch((error: unknown): void => {
        if (controller.signal.aborted) return;
        setListError(messageOf(error));
        setListState('failed');
      });
    return () => controller.abort();
  }, [listTick]);

  const load = useCallback(
    async (id: string, signal?: AbortSignal): Promise<ParseResult> =>
      parsePipeline(await readPipeline(id, signal)),
    [],
  );

  const readText = useCallback(async (id: string): Promise<string> => readPipeline(id), []);

  const save = useCallback(
    async (id: string, text: string): Promise<Saved> => savePipeline(id, text),
    [],
  );

  const create = useCallback(async (text: string): Promise<Created> => createPipeline(text), []);

  const reloadList = useCallback((): void => setListTick((n: number): number => n + 1), []);

  return { entries, listState, listError, load, readText, save, create, reloadList };
};
