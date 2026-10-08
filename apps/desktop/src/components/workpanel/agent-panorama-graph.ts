import {
  PANORAMA_GAP_X, PANORAMA_NODE_HEIGHT, PANORAMA_NODE_WIDTH,
  PANORAMA_ROOT_CHILD_GAP, PANORAMA_ROW_GAP,
  type PanoramaLayout,
} from "./agent-panorama-viewport";

export type PanoramaDependency = { from: string; to: string };
export type DependencyPanoramaLayout = PanoramaLayout & { edges: PanoramaDependency[] };

/** Dependency layers are presentation only; task order and the Host board stay authoritative. */
export function createDependencyPanoramaLayout(
  rootId: string,
  childIds: readonly string[],
  dependencies: readonly PanoramaDependency[],
): DependencyPanoramaLayout {
  const ids = [...new Set(childIds)];
  const known = new Set(ids);
  const edgeKeys = new Set<string>();
  const edges = dependencies.filter(({ from, to }) => {
    const key = JSON.stringify([from, to]);
    if (!known.has(from) || !known.has(to) || from === to || edgeKeys.has(key)) return false;
    edgeKeys.add(key);
    return true;
  });
  const parents = new Map(ids.map((id) => [id, edges.filter((edge) => edge.to === id).map((edge) => edge.from)]));
  const levels = new Map<string, number>();
  let pending = ids.slice();
  while (pending.length > 0) {
    const ready = pending.filter((id) => parents.get(id)!.every((parent) => levels.has(parent)));
    // A malformed cyclic snapshot remains visible, without inventing an ordering inside the cycle.
    if (ready.length === 0) {
      const level = Math.max(0, ...levels.values()) + 1;
      for (const id of pending) levels.set(id, level);
      break;
    }
    for (const id of ready) {
      const predecessors = parents.get(id)!;
      levels.set(id, predecessors.length === 0 ? 0 : Math.max(...predecessors.map((parent) => levels.get(parent)!)) + 1);
    }
    const consumed = new Set(ready);
    pending = pending.filter((id) => !consumed.has(id));
  }
  const rows: string[][] = [];
  for (const level of [...new Set(levels.values())].sort((a, b) => a - b)) {
    const tier = ids.filter((id) => levels.get(id) === level);
    for (let index = 0; index < tier.length; index += 3) rows.push(tier.slice(index, index + 3));
  }
  const columns = Math.max(1, ...rows.map((row) => row.length));
  const width = columns * PANORAMA_NODE_WIDTH + (columns - 1) * PANORAMA_GAP_X;
  const root = { id: rootId, x: (width - PANORAMA_NODE_WIDTH) / 2, y: 40 };
  const positions = rows.flatMap((row, rowIndex) => {
    const rowWidth = row.length * PANORAMA_NODE_WIDTH + (row.length - 1) * PANORAMA_GAP_X;
    return row.map((id, column) => ({
      id,
      x: (width - rowWidth) / 2 + column * (PANORAMA_NODE_WIDTH + PANORAMA_GAP_X),
      y: root.y + PANORAMA_NODE_HEIGHT + PANORAMA_ROOT_CHILD_GAP + rowIndex * (PANORAMA_NODE_HEIGHT + PANORAMA_ROW_GAP),
    }));
  });
  const byId = new Map(positions.map((position) => [position.id, position]));
  const children = ids.map((id) => byId.get(id)!);
  const height = (positions.at(-1)?.y ?? root.y) + PANORAMA_NODE_HEIGHT + 40;
  const allEdges = [
    ...ids.filter((id) => parents.get(id)!.length === 0).map((id) => ({ from: rootId, to: id })),
    ...edges,
  ];
  return { width, height, root, children, edges: allEdges,
    topologyKey: JSON.stringify({ root, children, edges: allEdges }) };
}
