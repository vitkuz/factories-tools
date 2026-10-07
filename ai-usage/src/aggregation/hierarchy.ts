import type { ActorFact, ActorKind, UsageEvent } from "../contract/usage-event.types.js";

export type ActorNode = {
  id: string;
  kind: ActorKind;
  name?: string;
  parentId?: string;
  depth: number;
};

export const MAIN_ACTOR_ID = "main";
export const UNATTRIBUTED_ACTOR_ID = "unattributed";

const actorIdOf = (event: UsageEvent): string =>
  event.actor.id ?? (event.actor.kind === "main" ? MAIN_ACTOR_ID : UNATTRIBUTED_ACTOR_ID);

/**
 * Builds the actor tree for one run from explicit actor facts plus whatever the
 * usage events themselves say. Facts win over event-level hints.
 */
export const buildActorTree = (facts: ActorFact[], events: UsageEvent[]): ActorNode[] => {
  const nodes: Map<string, ActorNode> = new Map<string, ActorNode>();

  events.forEach((event: UsageEvent): void => {
    const id: string = actorIdOf(event);
    const existing: ActorNode | undefined = nodes.get(id);
    const node: ActorNode = {
      id,
      kind: existing?.kind ?? event.actor.kind,
      depth: 0,
      ...((existing?.name ?? event.actor.name) ? { name: existing?.name ?? event.actor.name } : {}),
      ...((existing?.parentId ?? event.actor.parentId)
        ? { parentId: existing?.parentId ?? event.actor.parentId }
        : {}),
    };
    nodes.set(id, node);
  });

  facts.forEach((fact: ActorFact): void => {
    const existing: ActorNode | undefined = nodes.get(fact.id);
    nodes.set(fact.id, {
      id: fact.id,
      kind: fact.kind,
      depth: 0,
      ...((fact.name ?? existing?.name) ? { name: fact.name ?? existing?.name } : {}),
      ...((fact.parentId ?? existing?.parentId)
        ? { parentId: fact.parentId ?? existing?.parentId }
        : {}),
    });
  });

  const depthOf = (id: string, seen: Set<string>): number => {
    const node: ActorNode | undefined = nodes.get(id);
    if (!node || node.kind === "main" || node.kind === "unattributed") return 0;
    if (!node.parentId || seen.has(id)) return 1;
    return 1 + depthOf(node.parentId, new Set<string>([...seen, id]));
  };

  return Array.from(nodes.values())
    .map((node: ActorNode): ActorNode => ({ ...node, depth: depthOf(node.id, new Set<string>()) }))
    .sort((a: ActorNode, b: ActorNode): number => a.depth - b.depth || a.id.localeCompare(b.id));
};

export const eventActorId = actorIdOf;
