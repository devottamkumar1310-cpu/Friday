import { describe, expect, it } from 'vitest';
import {
  breakCycles,
  buildGraph,
  computeReadiness,
  directUnlockCount,
  topologicalOrder,
} from '../graph';
import type { ConceptEdge, ConceptNode } from '../types';

function node(id: string, overrides: Partial<ConceptNode> = {}): ConceptNode {
  return {
    id,
    title: id,
    examWeight: 0.5,
    estimatedMinutes: 30,
    status: 'not_started',
    ...overrides,
  };
}

function edge(from: string, to: string, strength = 1.0): ConceptEdge {
  return { fromConceptId: from, toConceptId: to, type: 'prerequisite_of', strength };
}

describe('core/graph', () => {
  it('topologically orders a linear chain', () => {
    const nodes = [node('c'), node('a'), node('b')];
    const edges = [edge('a', 'b'), edge('b', 'c')];
    const order = topologicalOrder(nodes, edges);
    expect(order.indexOf('a')).toBeLessThan(order.indexOf('b'));
    expect(order.indexOf('b')).toBeLessThan(order.indexOf('c'));
  });

  it('terminates and includes every node even on a cyclic graph (I-6)', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const edges = [edge('a', 'b'), edge('b', 'c'), edge('c', 'a')];
    const order = topologicalOrder(nodes, edges);
    expect(order.sort()).toEqual(['a', 'b', 'c']);
  });

  it('breaks a cycle at its weakest edge (E-5)', () => {
    const nodes = [node('a'), node('b'), node('c')];
    const edges = [edge('a', 'b', 1.0), edge('b', 'c', 1.0), edge('c', 'a', 0.2)];
    const { edges: acyclic, brokenEdges } = breakCycles(nodes, edges);
    expect(brokenEdges).toHaveLength(1);
    expect(brokenEdges[0]!.strength).toBe(0.2);
    // acyclic now
    const graph = buildGraph(nodes, acyclic);
    expect(graph.prerequisitesOf.get('a')).toBeUndefined();
  });

  it('direct unlock count is depth-1 out-degree (M0 leverage)', () => {
    const nodes = [node('a'), node('b'), node('c'), node('d')];
    const edges = [edge('a', 'b'), edge('a', 'c'), edge('c', 'd')];
    const graph = buildGraph(nodes, edges);
    expect(directUnlockCount(graph, 'a')).toBe(2);
    expect(directUnlockCount(graph, 'c')).toBe(1);
    expect(directUnlockCount(graph, 'd')).toBe(0);
  });

  it('readiness is 1.0 with no prerequisites (E-4)', () => {
    expect(computeReadiness([], 0.6)).toBe(1.0);
  });

  it('readiness is multiplicative and soft, approaching but not reaching zero', () => {
    const readiness = computeReadiness(
      [
        { effectiveMastery: 0.1, strength: 1.0 },
        { effectiveMastery: 0.1, strength: 1.0 },
      ],
      0.6,
    );
    expect(readiness).toBeGreaterThan(0);
    expect(readiness).toBeLessThan(0.1);
    // Hand-computed: min(1, 0.1/0.6)^1 = 0.1667; squared = 0.02778
    expect(readiness).toBeCloseTo((0.1 / 0.6) * (0.1 / 0.6), 4);
  });

  it('a learner past the readiness threshold gates fully open', () => {
    const readiness = computeReadiness([{ effectiveMastery: 0.9, strength: 1.0 }], 0.6);
    expect(readiness).toBe(1.0);
  });
});
