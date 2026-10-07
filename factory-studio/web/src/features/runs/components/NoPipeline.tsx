interface Props {
  pipelineId: string;
  knownPipelineIds: string[];
}

/** Explicit state for a run whose pipeline definition could not be found — never a wrong graph. */
export default function NoPipeline({ pipelineId, knownPipelineIds }: Props) {
  return (
    <div className="no-pipeline" role="region" aria-label="No pipeline definition">
      <h2>
        No pipeline definition for <code className="mono">{pipelineId}</code>
      </h2>
      <p>
        This run lives under <code className="mono">run/{pipelineId}/</code>, but no pipeline.json
        whose id is <code className="mono">{pipelineId}</code> was found under{' '}
        <code className="mono">factories/</code>, and the run folder has no copy of its own.
      </p>
      <p>Add or restore that file and this view updates by itself.</p>
      {knownPipelineIds.length > 0 && (
        <p className="muted">Pipelines found: {knownPipelineIds.join(', ')}</p>
      )}
    </div>
  );
}
