import type { ParamInfo } from '../../pipeline/pipeline.types.js';
import type { Finding, PipelineContext, PipelineRule } from '../rules.types.js';
import { defineRule } from '../rules.utils.js';

const SELECT = 'select';

export const paramsInfo: PipelineRule = defineRule<PipelineContext>({
  id: 'params-info',
  description:
    '"paramsInfo" (Studio UI only) describes declared params; "options" go with a "select", and a "select" has them.',
})(({ pipeline }, report) =>
  Object.entries(pipeline.paramsInfo ?? {}).flatMap(
    ([name, info]: [string, ParamInfo]): Finding[] => [
      ...(pipeline.params === undefined || !(name in pipeline.params)
        ? [report.warning(`paramsInfo.${name}: "${name}" is not a declared param`)]
        : []),
      ...(info.options !== undefined && info.type !== SELECT
        ? [
            report.warning(
              `paramsInfo.${name}: "options" is ignored unless "type" is "select" (got ${JSON.stringify(info.type ?? 'no type')})`,
            ),
          ]
        : []),
      ...(info.type === SELECT && (info.options ?? []).length === 0
        ? [report.warning(`paramsInfo.${name}: a "select" needs "options"`)]
        : []),
    ],
  ),
);
