/**
 * `core/graph` — prerequisite traversal, readiness, topological order, cycles.
 *
 * IMPLEMENTATION_ROADMAP 1.2. Pure functions over `ConceptNode[]` /
 * `ConceptEdge[]`. No I/O — the caller (a repository) resolves rows into these
 * shapes first.
 */

import type { ConceptEdge, ConceptNode } from '../types';

export interface Graph {
  nodes: Map<string, ConceptNode>;
  /** prerequisite_of edges only: `toConceptId -> incoming edges (its prerequisites)`. */
  prerequisitesOf: Map<string, ConceptEdge[]>;
  /** prerequisite_of edges only: `fromConceptId -> outgoing edges (what it unlocks)`. */
  unlocksOf: Map<string, ConceptEdge[]>;
}

export function buildGraph(nodes: ConceptNode[], edges: ConceptEdge[]): Graph {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  const prerequisitesOf = new Map<string, ConceptEdge[]>();
  const unlocksOf = new Map<string, ConceptEdge[]>();

  for (const edge of edges) {
    if (edge.type !== 'prerequisite_of') continue;
    if (!nodeMap.has(edge.fromConceptId) || !nodeMap.has(edge.toConceptId)) continue;

    if (!prerequisitesOf.has(edge.toConceptId)) prerequisitesOf.set(edge.toConceptId, []);
    prerequisitesOf.get(edge.toConceptId)!.push(edge);

    if (!unlocksOf.has(edge.fromConceptId)) unlocksOf.set(edge.fromConceptId, []);
    unlocksOf.get(edge.fromConceptId)!.push(edge);
  }

  return { nodes: nodeMap, prerequisitesOf, unlocksOf };
}

export function prerequisitesOf(graph: Graph, conceptId: string): ConceptEdge[] {
  return graph.prerequisitesOf.get(conceptId) ?? [];
}

/** Direct out-degree — the M0 leverage depth (AI_DECISION_ENGINE §1.1). */
export function directUnlockCount(graph: Graph, conceptId: string): number {
  return graph.unlocksOf.get(conceptId)?.length ?? 0;
}

/**
 * Bounded transitive descendant count, depth-capped at 6 (§6.2, DATABASE_DESIGN
 * §10). Deferred to M1 for live scoring (M0 uses `directUnlockCount`), but
 * exposed here because full-depth leverage is specified and the interface must
 * not need to change when it ships.
 */
export function transitiveDescendantCount(graph: Graph, conceptId: string, maxDepth = 6): number {
  const visited = new Set<string>();
  let frontier = new Set<string>([conceptId]);

  for (let depth = 0; depth < maxDepth && frontier.size > 0; depth++) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const edge of graph.unlocksOf.get(id) ?? []) {
        if (!visited.has(edge.toConceptId) && edge.toConceptId !== conceptId) {
          visited.add(edge.toConceptId);
          next.add(edge.toConceptId);
        }
      }
    }
    frontier = next;
  }
  return visited.size;
}

/**
 * Readiness (F4, the soft gate) — AI_DECISION_ENGINE §6.5.
 *
 *   Readiness(c) = Π over prerequisites p of min(1, m_eff(p) / θ)^strength(p)
 *
 * Multiplicative and soft: several weak prerequisites compound, but it
 * approaches zero rather than reaching it (I-4's "hard floor" is enforced by
 * the caller, not by this function returning exactly 0).
 */
export function computeReadiness(
  prerequisites: { effectiveMastery: number; strength: number }[],
  theta: number,
): number {
  if (prerequisites.length === 0) return 1.0; // E-4: no edges ⇒ readiness ≡ 1.0
  let readiness = 1.0;
  for (const { effectiveMastery, strength } of prerequisites) {
    const term = Math.min(1, effectiveMastery / theta);
    readiness *= Math.pow(term, strength);
  }
  return readiness;
}

export interface CycleBreakResult {
  edges: ConceptEdge[];
  brokenEdges: ConceptEdge[];
}

/**
 * Detects `prerequisite_of` cycles and breaks them at the weakest edge in each
 * cycle (E-5). The scheduler must terminate regardless of a content defect —
 * this never fails the caller's request; it returns an acyclic edge set plus
 * what it removed, so the caller can raise an integrity alert (DP9).
 */
export function breakCycles(nodes: ConceptNode[], edges: ConceptEdge[]): CycleBreakResult {
  const prereqEdges = edges.filter((e) => e.type === 'prerequisite_of');
  const otherEdges = edges.filter((e) => e.type !== 'prerequisite_of');
  const working = [...prereqEdges];
  const broken: ConceptEdge[] = [];

  // Iteratively find a cycle via DFS and remove its weakest edge, until acyclic.
  // Bounded by edge count so a malformed graph cannot loop forever (I-6).
  for (let guard = 0; guard < prereqEdges.length + 1; guard++) {
    const cycle = findCycle(nodes, working);
    if (!cycle) break;
    const weakest = cycle.reduce((min, e) => (e.strength < min.strength ? e : min), cycle[0]!);
    const idx = working.indexOf(weakest);
    if (idx === -1) break;
    working.splice(idx, 1);
    broken.push(weakest);
  }

  return { edges: [...working, ...otherEdges], brokenEdges: broken };
}

function findCycle(nodes: ConceptNode[], edges: ConceptEdge[]): ConceptEdge[] | null {
  const adjacency = new Map<string, ConceptEdge[]>();
  for (const edge of edges) {
    if (!adjacency.has(edge.fromConceptId)) adjacency.set(edge.fromConceptId, []);
    adjacency.get(edge.fromConceptId)!.push(edge);
  }

  const WHITE = 0,
    GRAY = 1,
    BLACK = 2;
  const color = new Map<string, number>(nodes.map((n) => [n.id, WHITE]));
  const pathEdges: ConceptEdge[] = [];

  function dfs(nodeId: string): ConceptEdge[] | null {
    color.set(nodeId, GRAY);
    for (const edge of adjacency.get(nodeId) ?? []) {
      const target = edge.toConceptId;
      if (color.get(target) === GRAY) {
        // Found the cycle: walk back along pathEdges to the repeated node.
        const cycleStart = pathEdges.findIndex((e) => e.fromConceptId === target);
        const cycle = cycleStart === -1 ? [edge] : [...pathEdges.slice(cycleStart), edge];
        return cycle;
      }
      if (color.get(target) === WHITE) {
        pathEdges.push(edge);
        const found = dfs(target);
        if (found) return found;
        pathEdges.pop();
      }
    }
    color.set(nodeId, BLACK);
    return null;
  }

  for (const node of nodes) {
    if (color.get(node.id) === WHITE) {
      const found = dfs(node.id);
      if (found) return found;
    }
  }
  return null;
}

/**
 * Kahn's-algorithm topological order over `prerequisite_of` edges. Assumes an
 * acyclic edge set — callers run `breakCycles` first (I-6).
 */
export function topologicalOrder(nodes: ConceptNode[], edges: ConceptEdge[]): string[] {
  const prereqEdges = edges.filter((e) => e.type === 'prerequisite_of');
  const inDegree = new Map<string, number>(nodes.map((n) => [n.id, 0]));
  const adjacency = new Map<string, string[]>(nodes.map((n) => [n.id, []]));

  for (const edge of prereqEdges) {
    if (!inDegree.has(edge.fromConceptId) || !inDegree.has(edge.toConceptId)) continue;
    adjacency.get(edge.fromConceptId)!.push(edge.toConceptId);
    inDegree.set(edge.toConceptId, (inDegree.get(edge.toConceptId) ?? 0) + 1);
  }

  const queue: string[] = [];
  for (const [id, degree] of inDegree) if (degree === 0) queue.push(id);
  queue.sort(); // deterministic tie-break (DP2)

  const order: string[] = [];
  while (queue.length > 0) {
    const id = queue.shift()!;
    order.push(id);
    const newlyZero: string[] = [];
    for (const next of adjacency.get(id) ?? []) {
      const remaining = (inDegree.get(next) ?? 0) - 1;
      inDegree.set(next, remaining);
      if (remaining === 0) newlyZero.push(next);
    }
    newlyZero.sort();
    queue.push(...newlyZero);
  }

  // A residual cycle (caller skipped breakCycles) still terminates: append
  // whatever is left, in a stable order, rather than looping (I-6).
  if (order.length < nodes.length) {
    const remaining = nodes.map((n) => n.id).filter((id) => !order.includes(id));
    remaining.sort();
    order.push(...remaining);
  }

  return order;
}
